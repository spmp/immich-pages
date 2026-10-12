import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { authContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { inferSafeImageMime, IMMICH_MAX_ORIGINAL_BYTES, readBoundedBytes } from '$server/immich/client';
import { extractAppleHdrMetadata } from '$server/media/hdr-metadata';
import { getHdrInteractiveCoordinator, type AuthorizedHdrAsset, type HdrActiveAssetState, type HdrProgressSnapshot } from '$server/media/hdr-prewarm';
import { buildHdrSourceIdentity } from '$server/media/hdr-cache';
import { parseHdrLookahead, targetLookahead, type HdrProjectionAsset } from '$server/media/hdr-prewarm-policy';
import { emptyHdrProgress, emitHdrProgressEvent, HDR_PREWARM_MAX_BODY_BYTES, HDR_PREWARM_MAX_GENERATION, HDR_PREWARM_MAX_POLL, HDR_PREWARM_MAX_POSITION, progressHeaders, redactHdrProgress } from '$server/media/hdr-progress';
import { operationScope, parseSharedLinkRef } from '$server/share/ref';
import { extractImmichShareToken, PAGES_SESSION_COOKIE, sessionForShare } from '$server/share/session';
import { logHdrPrewarmRequest } from '$server/share/diagnostics';
import { selectTargetResolution } from '$lib/media/resolution';

const CommandSchema = z.object({
	activeAssetId: z.string().uuid().max(64),
	activePosition: z.number().int().min(0).max(HDR_PREWARM_MAX_POSITION),
	representation: z.enum(['video', 'avif']),
	generation: z.number().int().min(0).max(HDR_PREWARM_MAX_GENERATION).optional(),
	poll: z.number().int().min(0).max(HDR_PREWARM_MAX_POLL).optional()
}).strict();

type EndpointEvent = Parameters<RequestHandler>[0];

function response(snapshot: HdrProgressSnapshot, status = 200): Response {
	return json(redactHdrProgress(snapshot), { status, headers: progressHeaders() });
}

async function readJson(request: Request): Promise<unknown> {
	const declared = request.headers.get('content-length');
	if (declared && (!/^\d+$/.test(declared) || Number(declared) > HDR_PREWARM_MAX_BODY_BYTES)) throw new Error('body-too-large');
	if (!request.body) return undefined;
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > HDR_PREWARM_MAX_BODY_BYTES) throw new Error('body-too-large');
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return JSON.parse(new TextDecoder().decode(bytes));
}

function requestContext(event: EndpointEvent, shareRef: NonNullable<ReturnType<typeof parseSharedLinkRef>>) {
	const session = sessionForShare(event.cookies.get(PAGES_SESSION_COOKIE), shareRef);
	if (session.cookie) event.cookies.set(PAGES_SESSION_COOKIE, session.cookie.split(';')[0].split('=')[1] ?? '', { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: session.token ? 86400 : 0 });
	const token = session.token ?? extractImmichShareToken(event.request.headers.get('cookie'));
	return { ...authContextFromRequest(event.request, shareRef), cookie: token ? `immich_shared_link_token=${token}` : null };
}

function projectionAsset(asset: { id: string; type: string; originalMimeType?: string; width?: number | null; height?: number | null }, position: number): HdrProjectionAsset {
	const mime = asset.originalMimeType?.toLowerCase();
	return { id: asset.id, position, eligible: asset.type === 'IMAGE' && (mime === 'image/heic' || mime === 'image/heif'), sourceIdentity: `${asset.id}:${mime ?? 'unknown'}:${asset.width ?? 'auto'}x${asset.height ?? 'auto'}`, width: asset.width ?? undefined, height: asset.height ?? undefined };
}

async function authorizedAssets(event: EndpointEvent, command: z.infer<typeof CommandSchema>, provider: ReturnType<typeof createImmichProvider>, context: Parameters<ReturnType<typeof createImmichProvider>['getSharedLink']>[0], scope: string): Promise<{ status: number; generation: number; assets?: AuthorizedHdrAsset[]; activeEligible?: boolean; snapshot?: HdrProgressSnapshot }> {
	const coordinator = getHdrInteractiveCoordinator();
	const generation = coordinator.getScopedGeneration(scope);
	if (command.generation !== undefined && command.generation !== generation) return { status: 409, generation, snapshot: emptyHdrProgress(generation, command.representation, 'partial') };
	const share = await provider.getSharedLink(context);
	if (share.status === 401 || share.status === 403) return { status: 403, generation };
	if (!share.data || share.data.type !== 'ALBUM' || !share.data.album) return { status: share.status === 404 ? 404 : 422, generation };
	const sourceAssets = share.data.assets;
	const active = sourceAssets[command.activePosition];
	if (!active || active.id !== command.activeAssetId) return { status: 400, generation, snapshot: emptyHdrProgress(generation, command.representation, 'partial') };
	const projection = sourceAssets.map((asset, position) => projectionAsset(asset, position));
	// Per-asset readiness (root_cause (3), hdr-caching-uat-20261010): the viewer's own active asset
	// may simply not be an HDR candidate at all (not HEIC/HEIF) -- that must report 'ineligible'
	// up front, distinct from 'unavailable' (eligible but this specific fetch/extraction failed).
	const activeEligible = projection[command.activePosition]?.eligible ?? false;
	const targets = targetLookahead(projection, command.activePosition, parseHdrLookahead());
	const assets: AuthorizedHdrAsset[] = [];
	for (const target of targets) {
		const source = await provider.getFullsizeImage(context, target.id);
		if (source.status === 401 || source.status === 403) return { status: 403, generation };
		if (!source.response?.ok) continue;
		try {
			const bytes = await readBoundedBytes(source.response, IMMICH_MAX_ORIGINAL_BYTES);
			const mime = inferSafeImageMime(bytes, source.response.headers.get('content-type'));
			if (mime !== 'image/heif' && mime !== 'image/heic') continue;
			const metadata = await extractAppleHdrMetadata(bytes);
			if (metadata) {
				// Keep the prewarm key byte-for-byte compatible with both interactive media
				// routes. A MIME/dimension identity is not equivalent to the media route's
				// upstream identity and silently causes a second conversion on swipe.
				const sourceIdentity = buildHdrSourceIdentity({ headers: source.response.headers, assetId: target.id, metadata, byteLength: bytes.byteLength });
				// Bound to the SAME scaled target the interactive route's client computes via
				// selectTargetResolution before it ever sends a ?width=/?height= query -- keying
				// on the raw Immich asset dimensions here only coincided with the interactive
				// route's key while the source stayed under 8192px/32MP, where scale is exactly 1.
				// Any larger source would otherwise permanently miss. See hdr-caching-uat-20261010
				// finding 5.
				const bounded = selectTargetResolution(target.width, target.height);
				assets.push({ ...target, sourceIdentity, width: bounded?.width ?? target.width, height: bounded?.height ?? target.height, sourceBytes: bytes, metadata });
			}
			else bytes.fill(0);
		} catch {
			await source.response.body?.cancel().catch(() => {});
		}
	}
	return { status: 200, generation, assets, activeEligible };
}

export const POST: RequestHandler = async (event) => {
	const shareRef = parseSharedLinkRef(event.params.kind, event.params.ref);
	const representation = event.request.headers.get('x-hdr-representation') === 'avif' ? 'avif' : 'video';
	// hdr-caching-uat-20261010 finding 6b: no /prewarm POST was previously logged server-side at
	// all, so a rejection from this exact control-plane endpoint was invisible. Every return path
	// below logs its own outcome -- status, activePosition, activeAssetId, targetedAssetIds, and
	// (only once known) activeAssetState.
	if (!shareRef) { logHdrPrewarmRequest({ status: 404 }); return response(emptyHdrProgress(0, representation, 'partial'), 404); }
	let command: z.infer<typeof CommandSchema>;
	try {
		const parsed = CommandSchema.safeParse(await readJson(event.request));
		if (!parsed.success) { logHdrPrewarmRequest({ status: 400 }); return response(emptyHdrProgress(getHdrInteractiveCoordinator().getGeneration(), representation, 'partial'), 400); }
		command = parsed.data;
	} catch (error) {
		const status = error instanceof Error && error.message === 'body-too-large' ? 413 : 400;
		logHdrPrewarmRequest({ status });
		return response(emptyHdrProgress(getHdrInteractiveCoordinator().getGeneration(), representation, 'partial'), status);
	}
	const context = requestContext(event, shareRef);
	const coordinator = getHdrInteractiveCoordinator();
	try {
		const result = await authorizedAssets(event, command, createImmichProvider(event.fetch), context, operationScope(shareRef));
		if (result.status !== 200) {
			if (result.status === 403) event.cookies.set(PAGES_SESSION_COOKIE, '', { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0 });
			logHdrPrewarmRequest({ status: result.status, activePosition: command.activePosition, activeAssetId: command.activeAssetId });
			return response(result.snapshot ?? emptyHdrProgress(result.generation, command.representation, 'partial'), result.status);
		}
		const scope = operationScope(shareRef);
		const assets = result.assets ?? [];
		// 'all' here targets exactly the (already window-bounded) assets authorizedAssets() fetched
		// -- not a second, independent lookahead decision. See hdr-caching-uat-20261010 evidence
		// 2026-10-10T22:33:00Z on why a second cap here would be an inert passthrough either way.
		const snapshot = coordinator.schedule({ assets, activePosition: -1, lookahead: { kind: 'all' }, generation: result.generation, scope }, command.representation, 'background');
		const requestId = event.locals?.requestId;
		if (snapshot.queued > 0) emitHdrProgressEvent('queued', command.representation, requestId);
		if (snapshot.running > 0) emitHdrProgressEvent('started', command.representation, requestId);
		if (snapshot.completed > 0) emitHdrProgressEvent('completed', command.representation, requestId);
		if (snapshot.failed > 0) emitHdrProgressEvent('failed', command.representation, requestId);
		if (snapshot.skipped > 0) emitHdrProgressEvent('skipped', command.representation, requestId);
		// Per-asset readiness (root_cause (3)): the status of the ONE asset the viewer currently
		// has open, independent of the aggregate window's own terminal/partial/preparing math --
		// see resolveHdrReadiness in hdr-readiness.ts, which treats this as the primary signal.
		let activeAssetState: HdrActiveAssetState;
		if (!result.activeEligible) {
			activeAssetState = 'ineligible';
		} else {
			const activeAsset = assets.find((asset) => asset.id === command.activeAssetId);
			if (!activeAsset) {
				activeAssetState = 'unavailable';
			} else {
				// Direct O(1) registry lookup, not a cache-key reconstruction -- see
				// activeState()'s own contract and hdr-caching-uat-20261010 root_cause (1)/CR-01.
				const state = coordinator.activeState(scope, activeAsset.id, command.representation);
				activeAssetState = state === 'none' ? 'unavailable' : state;
			}
		}
		logHdrPrewarmRequest({ status: 200, activePosition: command.activePosition, activeAssetId: command.activeAssetId, targetedAssetIds: assets.map((asset) => asset.id), activeAssetState });
		return response({ ...snapshot, activeAssetState });
	} catch {
		logHdrPrewarmRequest({ status: 502, activePosition: command.activePosition, activeAssetId: command.activeAssetId });
		return response(emptyHdrProgress(coordinator.getGeneration(), command.representation, 'partial'), 502);
	}
};

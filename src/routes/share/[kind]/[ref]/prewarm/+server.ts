import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { authContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { inferSafeImageMime, IMMICH_MAX_ORIGINAL_BYTES, readBoundedBytes } from '$server/immich/client';
import { extractAppleHdrMetadata } from '$server/media/hdr-metadata';
import { buildHdrMetadataCacheKey, getOrExtractHdrMetadata } from '$server/media/hdr-metadata-cache';
import { getHdrInteractiveCoordinator, type HdrActiveAssetState, type HdrProgressSnapshot, type HdrSourceFetcher } from '$server/media/hdr-prewarm';
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

type Provider = ReturnType<typeof createImmichProvider>;
type Context = Parameters<Provider['getSharedLink']>[0];

/**
 * Fetches one queued photo's original when the server's prewarm queue reaches it -- possibly after
 * this request has ended -- with this visitor's share context. Immich authorizes every fetch, so a
 * share revoked in the meantime yields 'revoked' and its queue is dropped.
 */
function sourceFetcher(provider: Provider, context: Context, projection: Map<string, HdrProjectionAsset>): HdrSourceFetcher {
	return async (assetId) => {
		const target = projection.get(assetId);
		if (!target) return 'unavailable';
		const source = await provider.getFullsizeImage(context, assetId);
		if (source.status === 401 || source.status === 403) return 'revoked';
		// No original to convert (a share without downloads answers 404): nothing to make for it.
		if (source.status === 404) return 'ineligible';
		if (!source.response?.ok) return 'unavailable';
		try {
			const bytes = await readBoundedBytes(source.response, IMMICH_MAX_ORIGINAL_BYTES);
			const mime = inferSafeImageMime(bytes, source.response.headers.get('content-type'));
			if (mime !== 'image/heif' && mime !== 'image/heic') return 'ineligible';
			// Byte-for-byte the same header-derived identity the interactive media routes use
			// (image/hdr, image/hdr-avif) for the same metadata cache, so exiftool runs once per photo.
			const headerSourceIdentity = [
				source.response.headers.get('etag'),
				source.response.headers.get('last-modified'),
				source.response.headers.get('content-length')
			].filter(Boolean).join('|') || `asset-${assetId}`;
			const metadataCacheKey = buildHdrMetadataCacheKey({ assetId, sourceIdentity: headerSourceIdentity });
			const metadata = await getOrExtractHdrMetadata(metadataCacheKey, () => extractAppleHdrMetadata(bytes));
			if (!metadata) { bytes.fill(0); return 'ineligible'; }
			// Keep the prewarm key byte-for-byte compatible with both interactive media routes, bound
			// to the same scaled target the client requests (selectTargetResolution), or a swipe
			// would miss the cache and convert a second time.
			const sourceIdentity = buildHdrSourceIdentity({ headers: source.response.headers, assetId, metadata, byteLength: bytes.byteLength });
			const bounded = selectTargetResolution(target.width, target.height);
			return { ...target, sourceIdentity, width: bounded?.width ?? target.width, height: bounded?.height ?? target.height, sourceBytes: bytes, metadata };
		} catch {
			await source.response.body?.cancel().catch(() => {});
			return 'unavailable';
		}
	};
}

async function queueShare(command: z.infer<typeof CommandSchema>, provider: Provider, context: Context, scope: string): Promise<{ status: number; generation: number; activeEligible?: boolean; targetedAssetIds?: string[]; snapshot?: HdrProgressSnapshot }> {
	const coordinator = getHdrInteractiveCoordinator();
	const generation = coordinator.getScopedGeneration(scope);
	if (command.generation !== undefined && command.generation !== generation) return { status: 409, generation, snapshot: emptyHdrProgress(generation, command.representation, 'partial') };
	const share = await provider.getSharedLink(context);
	if (share.status === 401 || share.status === 403) { coordinator.dropSources(scope); return { status: 403, generation }; }
	if (!share.data || share.data.type !== 'ALBUM' || !share.data.album) return { status: share.status === 404 ? 404 : 422, generation };
	const sourceAssets = share.data.assets;
	// Located by ID, with the page's position only as a hint: two Immich calls can return photos
	// with identical timestamps in a different order, and rejecting on a position mismatch showed
	// as an orange dot for no real reason. A photo that is not in the share is still refused.
	const activePosition = sourceAssets[command.activePosition]?.id === command.activeAssetId
		? command.activePosition
		: sourceAssets.findIndex((asset) => asset.id === command.activeAssetId);
	if (activePosition < 0) return { status: 400, generation, snapshot: emptyHdrProgress(generation, command.representation, 'partial') };
	const projection = sourceAssets.map((asset, position) => projectionAsset(asset, position));
	// The open photo may simply not be an HDR candidate (not HEIC/HEIF): reported 'ineligible'.
	const activeEligible = projection[activePosition]?.eligible ?? false;
	const lookahead = parseHdrLookahead();
	// From the open photo forward; for 'all', then round to the photos before it, so the whole
	// album really is covered whichever photo a visit starts from.
	const targets = lookahead !== 0 && lookahead.kind === 'all'
		? [...targetLookahead(projection, activePosition, lookahead), ...projection.filter((asset) => asset.eligible && asset.position < activePosition)]
		: targetLookahead(projection, activePosition, lookahead);
	// Queued on the server, in this order, and fetched there a few at a time: this request answers
	// at once, the work carries on after the page is left, and other shares' queues take turns
	// with this one. Photos already queued, converting, converted or without HDR data are skipped.
	const targetedAssetIds = targets.map((target) => target.id);
	coordinator.queueSources(scope, command.representation, targetedAssetIds, sourceFetcher(provider, context, new Map(targets.map((target) => [target.id, target]))));
	return { status: 200, generation, activeEligible, targetedAssetIds };
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
		const scope = operationScope(shareRef);
		const result = await queueShare(command, createImmichProvider(event.fetch), context, scope);
		if (result.status !== 200) {
			if (result.status === 403) event.cookies.set(PAGES_SESSION_COOKIE, '', { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0 });
			logHdrPrewarmRequest({ status: result.status, activePosition: command.activePosition, activeAssetId: command.activeAssetId });
			return response(result.snapshot ?? emptyHdrProgress(result.generation, command.representation, 'partial'), result.status);
		}
		const snapshot = coordinator.snapshot(result.generation, command.representation, scope);
		const requestId = event.locals?.requestId;
		if (snapshot.queued > 0) emitHdrProgressEvent('queued', command.representation, requestId);
		if (snapshot.running > 0) emitHdrProgressEvent('started', command.representation, requestId);
		if (snapshot.completed > 0) emitHdrProgressEvent('completed', command.representation, requestId);
		if (snapshot.failed > 0) emitHdrProgressEvent('failed', command.representation, requestId);
		if (snapshot.skipped > 0) emitHdrProgressEvent('skipped', command.representation, requestId);
		// The status of the one photo the viewer has open, independent of the whole prewarm's state
		// (see resolveHdrReadiness in hdr-readiness.ts, which treats this as the primary signal).
		let activeAssetState: HdrActiveAssetState;
		if (!result.activeEligible || coordinator.isIneligible(scope, command.activeAssetId)) {
			activeAssetState = 'ineligible';
		} else {
			const state = coordinator.activeState(scope, command.activeAssetId, command.representation);
			activeAssetState = state === 'none' ? (snapshot.queued > 0 ? 'queued' : 'unavailable') : state;
		}
		logHdrPrewarmRequest({ status: 200, activePosition: command.activePosition, activeAssetId: command.activeAssetId, targetedAssetIds: result.targetedAssetIds, activeAssetState });
		return response({ ...snapshot, activeAssetState });
	} catch {
		logHdrPrewarmRequest({ status: 502, activePosition: command.activePosition, activeAssetId: command.activeAssetId });
		return response(emptyHdrProgress(coordinator.getGeneration(), command.representation, 'partial'), 502);
	}
};

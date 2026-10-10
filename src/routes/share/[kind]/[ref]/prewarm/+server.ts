import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { authContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { inferSafeImageMime, IMMICH_MAX_ORIGINAL_BYTES, readBoundedBytes } from '$server/immich/client';
import { extractAppleHdrMetadata } from '$server/media/hdr-metadata';
import { getHdrInteractiveCoordinator, type AuthorizedHdrAsset, type HdrProgressSnapshot } from '$server/media/hdr-prewarm';
import { parseHdrLookahead, targetLookahead, type HdrProjectionAsset } from '$server/media/hdr-prewarm-policy';
import { emptyHdrProgress, HDR_PREWARM_MAX_BODY_BYTES, HDR_PREWARM_MAX_GENERATION, HDR_PREWARM_MAX_POSITION, progressHeaders, redactHdrProgress } from '$server/media/hdr-progress';
import { parseSharedLinkRef } from '$server/share/ref';
import { extractImmichShareToken, PAGES_SESSION_COOKIE, sessionForShare } from '$server/share/session';

const CommandSchema = z.object({
	activeAssetId: z.string().uuid().max(64),
	activePosition: z.number().int().min(0).max(HDR_PREWARM_MAX_POSITION),
	representation: z.enum(['video', 'avif']),
	generation: z.number().int().min(0).max(HDR_PREWARM_MAX_GENERATION).optional()
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

async function authorizedAssets(event: EndpointEvent, command: z.infer<typeof CommandSchema>, provider: ReturnType<typeof createImmichProvider>, context: Parameters<ReturnType<typeof createImmichProvider>['getSharedLink']>[0]): Promise<{ status: number; generation: number; assets?: AuthorizedHdrAsset[]; snapshot?: HdrProgressSnapshot }> {
	const coordinator = getHdrInteractiveCoordinator();
	const generation = coordinator.getGeneration();
	if (command.generation !== undefined && command.generation !== generation) return { status: 409, generation, snapshot: emptyHdrProgress(generation, command.representation, 'partial') };
	const share = await provider.getSharedLink(context);
	if (share.status === 401 || share.status === 403) return { status: 403, generation };
	if (!share.data || share.data.type !== 'ALBUM' || !share.data.album) return { status: share.status === 404 ? 404 : 422, generation };
	const sourceAssets = share.data.assets;
	const active = sourceAssets[command.activePosition];
	if (!active || active.id !== command.activeAssetId) return { status: 400, generation, snapshot: emptyHdrProgress(generation, command.representation, 'partial') };
	const projection = sourceAssets.map((asset, position) => projectionAsset(asset, position));
	const targets = targetLookahead(projection, command.activePosition, parseHdrLookahead());
	const assets: AuthorizedHdrAsset[] = [];
	for (const target of targets) {
		const source = await provider.getFullsizeImage(context, target.id);
		if (!source.response?.ok) continue;
		try {
			const bytes = await readBoundedBytes(source.response, IMMICH_MAX_ORIGINAL_BYTES);
			const mime = inferSafeImageMime(bytes, source.response.headers.get('content-type'));
			if (mime !== 'image/heif' && mime !== 'image/heic') continue;
			const metadata = await extractAppleHdrMetadata(bytes);
			assets.push({ ...target, sourceBytes: bytes, ...(metadata ? { metadata } : {}) });
		} catch {
			await source.response.body?.cancel().catch(() => {});
		}
	}
	return { status: 200, generation, assets };
}

export const POST: RequestHandler = async (event) => {
	const shareRef = parseSharedLinkRef(event.params.kind, event.params.ref);
	const representation = event.request.headers.get('x-hdr-representation') === 'avif' ? 'avif' : 'video';
	if (!shareRef) return response(emptyHdrProgress(0, representation, 'partial'), 404);
	let command: z.infer<typeof CommandSchema>;
	try {
		const parsed = CommandSchema.safeParse(await readJson(event.request));
		if (!parsed.success) return response(emptyHdrProgress(getHdrInteractiveCoordinator().getGeneration(), representation, 'partial'), 400);
		command = parsed.data;
	} catch {
		return response(emptyHdrProgress(getHdrInteractiveCoordinator().getGeneration(), representation, 'partial'), 413);
	}
	const context = requestContext(event, shareRef);
	const coordinator = getHdrInteractiveCoordinator();
	try {
		const result = await authorizedAssets(event, command, createImmichProvider(event.fetch), context);
		if (result.status !== 200) {
			if (result.status === 403) event.cookies.set(PAGES_SESSION_COOKIE, '', { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0 });
			return response(result.snapshot ?? emptyHdrProgress(result.generation, command.representation, 'partial'), result.status);
		}
		if (!result.assets?.length) return response(emptyHdrProgress(result.generation, command.representation));
		const snapshot = coordinator.schedule({ assets: result.assets, activePosition: -1, lookahead: { kind: 'all' }, generation: result.generation }, command.representation, 'background');
		return response(snapshot);
	} catch {
		return response(emptyHdrProgress(coordinator.getGeneration(), command.representation, 'partial'), 502);
	}
};

import type { ImmichProvider } from '$server/immich/provider';
import type { AuthorizedAlbumPage, DirectShareOutcome, SharedLinkResponse } from '$server/immich/types';
import type { AuthContext } from '$server/immich/auth-context';

const MAX_METADATA_BYTES = 16_384;

function metadata(description: string | null | undefined): 'page' | 'non-page' | 'invalid-metadata' {
	if (!description) return 'non-page';
	if (!description.startsWith('---')) return 'non-page';
	if (new TextEncoder().encode(description).byteLength > MAX_METADATA_BYTES) return 'invalid-metadata';
	const lines = description.split('\n');
	if (lines[0].trim() !== '---') return 'non-page';
	const closing = lines.slice(1).findIndex((line) => line.trim() === '---');
	if (closing < 0) return 'invalid-metadata';

	let inPresentation = false;
	let foundPresentation = false;
	let type: string | undefined;
	let version: string | undefined;
	for (const line of lines.slice(1, closing + 1)) {
		if (/^immich-presentation:\s*$/.test(line)) {
			if (foundPresentation) return 'invalid-metadata';
			foundPresentation = true;
			inPresentation = true;
			continue;
		}
		if (/^immich-presentation:\s+/.test(line)) return 'invalid-metadata';
		if (inPresentation && /^\s+/.test(line)) {
			const field = line.match(/^\s+(type|version):\s*(.*?)\s*$/);
			if (!field) continue;
			if (field[1] === 'type') {
				if (type !== undefined) return 'invalid-metadata';
				type = field[2];
			} else {
				if (version !== undefined) return 'invalid-metadata';
				version = field[2];
			}
			continue;
		}
		if (line.trim()) inPresentation = false;
	}
	if (!foundPresentation) return 'non-page';
	if (type !== 'journey' || version !== '1') return 'invalid-metadata';
	return 'page';
}

export async function assembleDirectShare(provider: ImmichProvider, context: AuthContext, requestId: string): Promise<DirectShareOutcome> {
	let result: Awaited<ReturnType<ImmichProvider['getSharedLink']>>;
	try { result = await provider.getSharedLink(context); } catch { return { kind: 'upstream-error', requestId }; }
	if (result.status === 401 || result.status === 403) return { kind: 'unauthorized' };
	if (result.status === 404) return { kind: 'not-found' };
	if (result.status === 422) return { kind: result.error === 'malformed' ? 'unsupported' : 'invalid-metadata' };
	if (!result.data) return { kind: 'upstream-error', requestId };
	const share: SharedLinkResponse = result.data;
	if (share.password) return { kind: 'password-required' };
	if (share.type !== 'ALBUM' || !share.album) return { kind: 'unsupported' };
	const status = metadata(share.album.description);
	if (status !== 'page') return { kind: status };
	const assets = share.assets.map((asset) => ({
		id: asset.id, type: asset.type, fileName: asset.originalFileName,
		thumbnail: `/share/${context.shareRef.kind}/${encodeURIComponent(context.shareRef.value)}/media/${encodeURIComponent(asset.id)}/thumbnail`
	}));
	const page: AuthorizedAlbumPage = {
		album: { id: share.album.id, title: share.album.albumName ?? 'Untitled album', description: share.album.description ?? '' },
		assets,
		showMetadata: share.showMetadata,
		allowDownload: share.allowDownload
	};
	return { kind: 'page', page };
}

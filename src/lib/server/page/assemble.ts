import type { ImmichProvider } from '$server/immich/provider';
import type { AuthorizedAlbumPage, DirectShareOutcome, SharedLinkResponse } from '$server/immich/types';
import type { AuthContext } from '$server/immich/auth-context';

function metadata(description: string | null | undefined): 'page' | 'non-page' | 'invalid-metadata' {
	if (!description) return 'non-page';
	const match = description.match(/^---\s*\n([\s\S]*?)\n---/);
	if (!match) return 'non-page';
	const body = match[1];
	const type = body.match(/^immich-presentation:\s*\n(?:\s+.*\n)*?\s+type:\s*([^\n]+)$/m)?.[1]?.trim();
	const version = body.match(/^immich-presentation:\s*\n(?:\s+.*\n)*?\s+version:\s*([^\n]+)$/m)?.[1]?.trim();
	if (!type && !version) return 'non-page';
	if (type !== 'journey' || version !== '1') return 'invalid-metadata';
	return 'page';
}

export async function assembleDirectShare(provider: ImmichProvider, context: AuthContext, requestId: string): Promise<DirectShareOutcome> {
	let result: Awaited<ReturnType<ImmichProvider['getSharedLink']>>;
	try { result = await provider.getSharedLink(context); } catch { return { kind: 'upstream-error', requestId }; }
	if (result.status === 401 || result.status === 403) return { kind: 'unauthorized' };
	if (result.status === 404) return { kind: 'not-found' };
	if (result.status === 422) return { kind: 'invalid-metadata' };
	if (!result.data) return { kind: 'upstream-error', requestId };
	const share: SharedLinkResponse = result.data;
	if (share.password) return { kind: 'password-required' };
	const status = metadata(share.album.description);
	if (status !== 'page') return { kind: status };
	const assets = share.assets.map((asset) => {
		const thumbnail = asset.thumbnailPath;
		const view = asset.viewPath;
		return thumbnail && view ? { id: asset.id, type: asset.type, fileName: asset.originalFileName, thumbnail, view } : null;
	}).filter((asset): asset is NonNullable<typeof asset> => asset !== null);
	if (assets.length !== share.assets.length) return { kind: 'unsupported' };
	const page: AuthorizedAlbumPage = {
		album: { id: share.album.id, title: share.album.albumName ?? 'Untitled album', description: share.album.description ?? '' },
		assets,
		showMetadata: share.showMetadata,
		allowDownload: share.allowDownload
	};
	return { kind: 'page', page };
}

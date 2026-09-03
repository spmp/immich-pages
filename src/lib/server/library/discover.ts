import { parsePresentationDocument } from '$server/presentation/frontmatter';
import { deriveDisplayDate } from '$server/presentation/model';
import type { ImmichProvider } from '$server/immich/provider';
import type { UserSessionContext } from '$server/immich/auth-context';
import { issueLibraryLocator } from '$server/immich/locator';
import type { LibraryResult, NavigationEntry } from './model';
import { visibilityAllows } from './permissions';

const MAX_ALBUMS = 1000;
export async function discoverLibrary(provider: ImmichProvider, context: UserSessionContext, now = Date.now()): Promise<LibraryResult> {
	const user = await provider.getCurrentUser(context); if (!user.data) return { kind: user.status === 401 || user.status === 403 ? 'access' : 'temporary', entries: [], warnings: [] };
	const listed = await provider.listAlbums(context); if (!listed.data) return { kind: listed.status === 401 || listed.status === 403 ? 'access' : 'temporary', entries: [], warnings: [] };
	const entries: Array<NavigationEntry & { sortDate: string; id: string }> = []; let failures = 0;
	for (const album of listed.data.slice(0, MAX_ALBUMS)) {
		try {
			const [detail, assets] = await Promise.all([provider.getAlbum(context, album.id), provider.getAlbumAssets(context, album.id)]);
			if (!detail.data || !assets.data) { failures++; continue; }
			const document = parsePresentationDocument(detail.data.description);
			if (document.kind !== 'valid' || !visibilityAllows(undefined, user.data)) continue;
			const shareLike = { assets: assets.data, album: { ...detail.data, albumName: detail.data.albumName, description: detail.data.description ?? null, id: detail.data.id, assets: assets.data }, type: 'ALBUM' as const } as Parameters<typeof deriveDisplayDate>[1];
			const date = deriveDisplayDate(document.config, shareLike); const locator = issueLibraryLocator(album.id, now);
			entries.push({ href: `/library/page/${locator}`, title: album.albumName, date, thumbnail: album.albumThumbnailAssetId && assets.data.some((asset) => asset.id === album.albumThumbnailAssetId) ? `/library/media/${locator}/${album.albumThumbnailAssetId}/thumbnail` : undefined, sortDate: date?.start ?? detail.data.updatedAt ?? detail.data.endDate ?? detail.data.startDate ?? '', id: locator });
		} catch { failures++; }
	}
	entries.sort((a, b) => b.sortDate.localeCompare(a.sortDate) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
	const clean = entries.map(({ sortDate: _sortDate, id: _id, ...entry }) => entry);
	return { kind: clean.length ? 'ready' : failures ? 'temporary' : 'empty', entries: clean, warnings: failures ? ['some-pages-unavailable'] : [] };
}

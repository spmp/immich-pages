import type { ImmichProvider } from '$server/immich/provider';
import type { AuthorizedAlbumPage, DirectShareOutcome, SharedLinkResponse } from '$server/immich/types';
import type { AuthContext } from '$server/immich/auth-context';
import { parsePresentationDocument } from '$server/presentation/frontmatter';
import { renderMarkdown } from '$server/presentation/markdown';
import { deriveDisplayDate, normalizeTemplate, selectHero, type NormalizedPageModel } from '$server/presentation/model';

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
	const document = parsePresentationDocument(share.album.description);
	if (document.kind === 'absent' || document.kind === 'unrelated') return { kind: 'non-page' };
	if (document.kind === 'invalid') return { kind: 'invalid-metadata', metadataReason: document.reason };
	const narrative = await renderMarkdown(document.markdown);
	const hero = selectHero(document.config, share);
	const template = normalizeTemplate(document.config);
	const displayDate = deriveDisplayDate(document.config, share);
	const assets = share.assets.map((asset) => ({
		id: asset.id, type: asset.type, fileName: asset.originalFileName,
		thumbnail: `/share/${context.shareRef.kind}/${encodeURIComponent(context.shareRef.value)}/media/${encodeURIComponent(asset.id)}/thumbnail`,
		width: asset.width, height: asset.height,
		videoHref: asset.type === 'VIDEO' ? `/share/${context.shareRef.kind}/${encodeURIComponent(context.shareRef.value)}/media/${encodeURIComponent(asset.id)}/video/playback` : undefined
	}));
	const page: AuthorizedAlbumPage = {
		album: { id: share.album.id, title: share.album.albumName ?? 'Untitled album', description: document.markdown,
			thumbnailAssetId: share.album.albumThumbnailAssetId ?? undefined, startDate: share.album.startDate ?? undefined,
			endDate: share.album.endDate ?? undefined, updatedAt: share.album.updatedAt },
		assets,
		showMetadata: share.showMetadata,
		allowDownload: share.allowDownload
	};
	const normalized: NormalizedPageModel = {
		album: page.album,
		presentation: { ...document.config, template: template.template },
		narrativeHtml: narrative.html,
		assets: assets.map((asset) => document.config.gallery.captions[asset.id] ? { ...asset, caption: document.config.gallery.captions[asset.id] } : asset),
		permissions: { showMetadata: page.showMetadata, allowDownload: page.allowDownload },
		hero: hero ? { id: hero.id, thumbnail: assets.find((asset) => asset.id === hero.id)?.thumbnail ?? '' } : null,
		markers: [], routeData: null,
		showMetadata: page.showMetadata, allowDownload: page.allowDownload,
		warnings: [...document.warnings, ...narrative.warnings, ...(template.warning ? [template.warning] : [])], errors: []
	};
	if (displayDate) normalized.album = { ...normalized.album, startDate: displayDate.start, endDate: displayDate.end };
	return { kind: 'page', page: normalized };
}

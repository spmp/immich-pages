import type { ImmichProvider } from '$server/immich/provider';
import type { DirectShareOutcome, SharedLinkResponse } from '$server/immich/types';
import type { AuthContext, ShareAuthContext } from '$server/immich/auth-context';
import { parsePresentationDocument } from '$server/presentation/frontmatter';
import { renderMarkdown } from '$server/presentation/markdown';
import { deriveDisplayDate, heroSelection, normalizeTemplate, selectHero, type NormalizedPageModel } from '$server/presentation/model';
import { logMapRouteResult, logMetadataParse, logModelOutput, logShareHeroSelection } from '$server/share/diagnostics';
import { projectMapMarkers } from '$server/map/markers';
import { PathSourceRegistry } from '$server/map/path-adapters';
import { resolveMapStyle } from '$server/map/style-registry';

export async function assembleDirectShare(provider: ImmichProvider, context: ShareAuthContext, requestId: string): Promise<DirectShareOutcome> {
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
	if (document.kind === 'absent' || document.kind === 'unrelated') { logMetadataParse({ result: document.kind }); return { kind: 'non-page' }; }
	if (document.kind === 'invalid') { logMetadataParse({ result: 'invalid', reason: document.reason }); return { kind: 'invalid-metadata', metadataReason: document.reason }; }
	return assemblePageModel(provider, context, share, (assetId) => `/share/${context.shareRef.kind}/${encodeURIComponent(context.shareRef.value)}/media/${encodeURIComponent(assetId)}`);
}

async function assemblePageModel(provider: ImmichProvider, context: AuthContext, share: SharedLinkResponse, mediaPath: (assetId: string) => string): Promise<DirectShareOutcome> {
	const document = parsePresentationDocument(share.album?.description);
	if (document.kind !== 'valid') return document.kind === 'invalid' ? { kind: 'invalid-metadata', metadataReason: document.reason } : { kind: 'non-page' };
	const sourceAlbum = share.album;
	if (!sourceAlbum) return { kind: 'unsupported' };
	logMetadataParse({ result: 'valid' });
	const narrative = await renderMarkdown(document.markdown);
	const hero = selectHero(document.config, share);
	logShareHeroSelection({ selection: heroSelection(document.config, share) });
	const template = normalizeTemplate(document.config);
	const displayDate = deriveDisplayDate(document.config, share);
	const { auth: _auth, gradient, ...presentationSafeConfig } = document.config;
	const { url: _brouterUrl, ...browserMap } = document.config.map;
	const assets = share.assets.map((asset) => {
		const normalized = {
			id: asset.id, type: asset.type,
			thumbnail: `${mediaPath(asset.id)}/thumbnail${'shareRef' in context ? `?${context.shareRef.kind}=${encodeURIComponent(context.shareRef.value)}` : ''}`
			, ...(asset.type !== 'VIDEO' ? { fullsize: `${mediaPath(asset.id)}/image/fullsize${'shareRef' in context ? `?${context.shareRef.kind}=${encodeURIComponent(context.shareRef.value)}` : ''}` } : {})
			, ...(asset.originalMimeType?.startsWith('image/') ? { sourceMimeType: asset.originalMimeType } : {})
		};
		return {
			...normalized,
			...(share.showMetadata && asset.width !== undefined ? { width: asset.width } : {}),
			...(share.showMetadata && asset.height !== undefined ? { height: asset.height } : {}),
			...(asset.type === 'VIDEO' && 'shareRef' in context ? { videoHref: `${mediaPath(asset.id)}/video/playback?${context.shareRef.kind}=${encodeURIComponent(context.shareRef.value)}` } : {})
		};
	});
	const album = {
		title: sourceAlbum.albumName ?? 'Untitled album',
		thumbnailAssetId: sourceAlbum.albumThumbnailAssetId ?? undefined,
		...(share.showMetadata ? { startDate: sourceAlbum.startDate ?? undefined, endDate: sourceAlbum.endDate ?? undefined, updatedAt: sourceAlbum.updatedAt } : {})
	};
	const { waypoints: _waypoints, geojson: _geojson, ...metadataSafeMap } = browserMap;
	const safeMap = share.showMetadata ? browserMap : { ...metadataSafeMap, enabled: false };
	const normalized: NormalizedPageModel = {
		album,
		presentation: { ...presentationSafeConfig, ...(gradient ? { gradient } : {}), map: safeMap, template: template.template },
		narrativeHtml: narrative.html,
		assets: assets.map((asset) => ({
			...asset,
			...(document.config.gallery.showCaptions && document.config.gallery.captions[asset.id] ? { caption: document.config.gallery.captions[asset.id] } : {}),
			...(document.config.gallery.fullWidth.includes(asset.id) ? { fullWidth: true } : {})
		})),
		permissions: { showMetadata: share.showMetadata, allowDownload: share.allowDownload },
		hero: hero ? { id: hero.id, thumbnail: assets.find((asset) => asset.id === hero.id)?.thumbnail ?? '' } : null,
		markers: [], routeData: null,
		showMetadata: share.showMetadata, allowDownload: share.allowDownload,
		warnings: [...document.warnings, ...narrative.warnings, ...(template.warning ? [template.warning] : [])], errors: []
	};
	if (document.config.map.enabled && share.showMetadata) {
		const pathRegistry = new PathSourceRegistry();
		const markerResponse = share.showMetadata ? await provider.getMapMarkers(context, sourceAlbum.id) : { status: 200, data: [] };
		const projected = markerResponse.data ? projectMapMarkers(markerResponse.data, share.assets) : { markers: [], warnings: ['map-no-location'] as const };
		normalized.markers = projected.markers;
		normalized.warnings.push(...projected.warnings);
		const routeStartedAt = Date.now();
		const route = await pathRegistry.resolve(document.config.map, { markers: projected.markers, assets: share.assets });
		logMapRouteResult({ adapter: document.config.map.source, warnings: route.warnings, durationMs: Date.now() - routeStartedAt });
		if (route.kind === 'resolved') normalized.routeData = route.route;
		normalized.warnings.push(...route.warnings);
		const style = resolveMapStyle({ styleName: document.config.map.styleName });
		if (style.kind === 'resolved') normalized.mapStyle = style;
		else normalized.warnings.push('map-style-unavailable');
	}
	if (share.showMetadata && displayDate) normalized.album = { ...normalized.album, startDate: displayDate.start, endDate: displayDate.end };
	logModelOutput({ assetCount: assets.length, imageCount: assets.filter((asset) => asset.type !== 'VIDEO').length, videoCount: assets.filter((asset) => asset.type === 'VIDEO').length, heroPresent: Boolean(normalized.hero), markerCount: normalized.markers.length, routeReady: normalized.routeData !== null });
	return { kind: 'page', page: normalized };
}

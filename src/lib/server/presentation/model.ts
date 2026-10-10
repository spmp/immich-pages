import type { SharedLinkResponse } from '$server/immich/types';
import type { PresentationConfig } from './schema';
import type { MapMarker, MapRoute } from '$server/map/types';
import type { HdrProjectionAsset } from '$server/media/hdr-prewarm-policy';

export type NormalizedGradient =
	| { auto: true; direction: 'to bottom' | '135deg'; top?: undefined; bottom?: undefined }
	| { auto: false; direction: 'to bottom' | '135deg'; top: string; bottom: string };
export type AuthorizedHeroRepresentation = { id: string; thumbnail: string };
export type NormalizedAsset = { id: string; type: string; thumbnail: string; fullsize?: string; hdrHref?: string; hdrAvifHref?: string; sourceMimeType?: string; caption?: string; width?: number | null; height?: number | null; sourceWidth?: number; sourceHeight?: number; videoHref?: string; fullWidth?: boolean };
export type NormalizedPageModel = {
	album: { id?: string; title: string; thumbnailAssetId?: string; startDate?: string; endDate?: string; updatedAt?: string };
	presentation: Omit<PresentationConfig, 'gradient'> & { template: string; gradient?: NormalizedGradient };
	narrativeHtml: string;
	assets: NormalizedAsset[];
	permissions: { showMetadata: boolean; allowDownload: boolean };
	showMetadata: boolean;
	allowDownload: boolean;
	hero: AuthorizedHeroRepresentation | null;
	markers: MapMarker[];
	routeData: MapRoute | null;
	mapStyle?: { name: 'quiet-atlas'; url: string };
	warnings: string[];
	errors: string[];
};

/** Project the already-authorized viewer sequence without exposing upstream DTOs. */
export function projectHdrAssets(assets: readonly NormalizedAsset[]): HdrProjectionAsset[] {
	return assets.map((asset, position) => {
		const mime = asset.sourceMimeType?.toLowerCase();
		return {
			id: asset.id,
			position,
			eligible: asset.type === 'IMAGE' && (mime === 'image/heic' || mime === 'image/heif'),
			sourceIdentity: `${asset.id}:${mime ?? 'unknown'}:${asset.sourceWidth ?? 'auto'}x${asset.sourceHeight ?? 'auto'}`,
			...(asset.sourceWidth !== undefined ? { width: asset.sourceWidth } : {}),
			...(asset.sourceHeight !== undefined ? { height: asset.sourceHeight } : {})
		};
	});
}

export function deriveDisplayDate(config: PresentationConfig, share: SharedLinkResponse): { start: string; end: string } | undefined {
	if (config.date) return { start: config.date, end: config.date };
	if (config.dateRange?.start || config.dateRange?.end) {
		const start = config.dateRange.start ?? config.dateRange.end!;
		const end = config.dateRange.end ?? config.dateRange.start!;
		return { start, end };
	}
	const dates = share.assets.map((asset) => asset.localDateTime ?? asset.createdAt).filter((date): date is string => Boolean(date)).sort();
	if (dates.length) return { start: dates[0], end: dates[dates.length - 1] };
	const start = share.album?.startDate ?? share.album?.endDate;
	const end = share.album?.endDate ?? share.album?.startDate;
	return start && end ? { start, end } : undefined;
}

export function normalizeTemplate(config: PresentationConfig): { template: 'journal'; warning?: string } {
	return config.template === 'journal' ? { template: 'journal' } : { template: 'journal', warning: 'unknown-template' };
}

export function selectHero(config: PresentationConfig, share: SharedLinkResponse) {
	const assets = share.assets;
	const filename = config.hero.filename?.toLocaleLowerCase();
	if (filename) {
		const matches = assets.filter((asset) => asset.originalFileName?.toLocaleLowerCase() === filename);
		if (matches.length === 1) return matches[0];
	}
	if (config.hero.assetId) {
		const selected = assets.find((asset) => asset.id === config.hero.assetId);
		if (selected) return selected;
	}
	if (share.album?.albumThumbnailAssetId) {
		const cover = assets.find((asset) => asset.id === share.album?.albumThumbnailAssetId);
		if (cover) return cover;
	}
	return assets[0];
}

export function heroSelection(config: PresentationConfig, share: SharedLinkResponse): 'configured-filename' | 'configured-asset-id' | 'album-cover' | 'first-asset' | 'none' {
	const assets = share.assets;
	if (config.hero.filename && assets.filter((asset) => asset.originalFileName?.toLocaleLowerCase() === config.hero.filename!.toLocaleLowerCase()).length === 1) return 'configured-filename';
	if (config.hero.assetId && assets.some((asset) => asset.id === config.hero.assetId)) return 'configured-asset-id';
	if (share.album?.albumThumbnailAssetId && assets.some((asset) => asset.id === share.album?.albumThumbnailAssetId)) return 'album-cover';
	return assets.length > 0 ? 'first-asset' : 'none';
}

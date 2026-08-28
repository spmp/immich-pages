import type { SharedLinkResponse } from '$server/immich/types';
import type { PresentationConfig } from './schema';

export type NormalizedAsset = { id: string; type: string; fileName?: string; thumbnail: string; caption?: string };
export type NormalizedPageModel = {
	album: { id: string; title: string; description: string; thumbnailAssetId?: string; startDate?: string; endDate?: string; updatedAt?: string };
	presentation: PresentationConfig & { template: string };
	narrativeHtml: string;
	assets: NormalizedAsset[];
	permissions: { showMetadata: boolean; allowDownload: boolean };
	showMetadata: boolean;
	allowDownload: boolean;
	hero: { id: string; thumbnail: string } | null;
	markers: [];
	routeData: null;
	warnings: string[];
	errors: string[];
};

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

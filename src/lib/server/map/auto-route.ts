import type { SharedAsset } from '$server/immich/types';
import type { MapMarker, MapRoute, MapWarning } from './types';

export const DUPLICATE_DISTANCE_METERS = 25;
export const MAX_ROUTE_VERTICES = 500;

function timestamp(asset: SharedAsset): number {
	const value = asset.localDateTime ?? asset.createdAt;
	if (!value) return Number.POSITIVE_INFINITY;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function distanceMeters(a: MapMarker, b: MapMarker): number {
	const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
	const dx = (b.lon - a.lon) * 111320 * Math.cos(lat);
	const dy = (b.lat - a.lat) * 110540;
	return Math.sqrt(dx * dx + dy * dy);
}

export function deriveAutoRoute(markers: readonly MapMarker[], assets: readonly SharedAsset[]): { routeData: MapRoute | null; warnings: MapWarning[] } {
	const index = new Map(assets.map((asset, position) => [asset.id, { asset, position }]));
	const ordered = [...markers]
		.map((marker) => ({ marker, source: index.get(marker.id) }))
		.filter((item): item is { marker: MapMarker; source: { asset: SharedAsset; position: number } } => Boolean(item.source))
		.sort((a, b) => timestamp(a.source.asset) - timestamp(b.source.asset) || a.source.position - b.source.position);
	const retained: MapMarker[] = [];
	for (const item of ordered) {
		if (retained.length >= MAX_ROUTE_VERTICES) break;
		if (!retained.length || distanceMeters(retained[retained.length - 1], item.marker) > DUPLICATE_DISTANCE_METERS) retained.push(item.marker);
	}
	return { routeData: retained.length >= 2 ? { type: 'LineString', coordinates: retained.map(({ lon, lat }) => [lon, lat]) } : null, warnings: [] };
}

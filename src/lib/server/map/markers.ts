import type { SharedAsset } from '$server/immich/types';
import { MapMarkerResponseSchema } from '$server/immich/types';
import type { MapMarker, MapWarning } from './types';

export const MAX_MARKERS = 500;
export const MAX_COLLOCATED_LEAVES = 500;

export type MapMarkerResponse = import('$server/immich/types').MapMarkerResponse;

function usableCoordinate(marker: MapMarkerResponse): boolean {
	return marker.lat >= -90 && marker.lat <= 90 && marker.lon >= -180 && marker.lon <= 180;
}

function labelFor(marker: MapMarkerResponse): string | undefined {
	const label = [marker.city, marker.state, marker.country].map((value) => value?.trim() || null).filter(Boolean).join(', ');
	return label ? label.slice(0, 256) : undefined;
}

export function projectMapMarkers(input: unknown, authorizedAssets: readonly SharedAsset[]): { markers: MapMarker[]; warnings: MapWarning[] } {
	if (!Array.isArray(input)) return { markers: [], warnings: ['map-no-location'] };
	const authorized = new Set(authorizedAssets.map((asset) => asset.id));
	const warnings: MapWarning[] = [];
	const candidates = input.slice(0, MAX_MARKERS).map((value) => MapMarkerResponseSchema.safeParse(value)).filter((result): result is { success: true; data: MapMarkerResponse } => result.success).map((result) => result.data);
	if (input.length > MAX_MARKERS) warnings.push('map-marker-limit');
	const markers = candidates
		.filter((marker) => authorized.has(marker.id) && usableCoordinate(marker))
		.map((marker) => ({ id: marker.id, lat: marker.lat, lon: marker.lon, ...(labelFor(marker) ? { label: labelFor(marker) } : {}) }));
	if (!markers.length) warnings.push('map-no-location');
	return { markers, warnings };
}

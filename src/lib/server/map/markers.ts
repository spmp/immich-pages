import { z } from 'zod';
import type { SharedAsset } from '$server/immich/types';
import type { MapMarker, MapWarning } from './types';

export const MAX_MARKERS = 500;
export const MAX_COLLOCATED_LEAVES = 500;

const MapMarkerResponseSchema = z.object({
	id: z.uuidv4(),
	lat: z.number().finite(),
	lon: z.number().finite(),
	city: z.string().nullable(),
	state: z.string().nullable(),
	country: z.string().nullable()
});
export const MapMarkerResponseArraySchema = z.array(MapMarkerResponseSchema);
export type MapMarkerResponse = z.infer<typeof MapMarkerResponseSchema>;

function usableCoordinate(marker: MapMarkerResponse): boolean {
	return marker.lat >= -90 && marker.lat <= 90 && marker.lon >= -180 && marker.lon <= 180;
}

function labelFor(marker: MapMarkerResponse): string | undefined {
	const label = [marker.city, marker.state, marker.country].filter(Boolean).join(', ');
	return label ? label.slice(0, 256) : undefined;
}

export function projectMapMarkers(input: unknown, authorizedAssets: readonly SharedAsset[]): { markers: MapMarker[]; warnings: MapWarning[] } {
	const parsed = MapMarkerResponseArraySchema.safeParse(input);
	if (!parsed.success) return { markers: [], warnings: ['map-no-location'] };
	const authorized = new Set(authorizedAssets.map((asset) => asset.id));
	const warnings: MapWarning[] = [];
	const candidates = parsed.data.slice(0, MAX_MARKERS);
	if (parsed.data.length > MAX_MARKERS) warnings.push('map-marker-limit');
	const markers = candidates
		.filter((marker) => authorized.has(marker.id) && usableCoordinate(marker))
		.map((marker) => ({ id: marker.id, lat: marker.lat, lon: marker.lon, ...(labelFor(marker) ? { label: labelFor(marker) } : {}) }));
	if (!markers.length) warnings.push('map-no-location');
	return { markers, warnings };
}

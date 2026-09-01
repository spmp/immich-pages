import type { SharedAsset } from '$server/immich/types';
import { deriveAutoRoute } from './auto-route';
import { MAX_ROUTE_BYTES, MAX_ROUTE_SEGMENTS, normalizeRouteGeometry } from './geometry';
import type { MapMarker, MapWarning, PathResult } from './types';

export type Waypoint = [number, number];
export type PathSource = 'auto' | 'waypoints' | 'geojson' | 'brouter-web';

export { MAX_ROUTE_BYTES, MAX_ROUTE_SEGMENTS } from './geometry';

type PathContext = { markers: readonly MapMarker[]; assets: readonly SharedAsset[] };
type Adapter<Input> = (input: Input, context: PathContext) => PathResult | Promise<PathResult>;

function validPosition(value: unknown): value is Waypoint {
	return Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part)) && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
}

export function resolveWaypoints(value: unknown): PathResult {
	if (!Array.isArray(value) || value.length < 2 || value.length > 500 || !value.every(validPosition)) return { kind: 'unavailable', warnings: ['map-route-invalid'] };
	const coordinates = value.map(([lon, lat]) => [lon, lat] as Waypoint);
	return { kind: 'resolved', route: { type: 'LineString', coordinates }, warnings: [] };
}

export type PathConfig = { source: PathSource; waypoints?: unknown; geojson?: unknown };

const adapters: Record<PathSource, Adapter<unknown>> = {
	auto: (_input, context) => {
		const result = deriveAutoRoute(context.markers, context.assets);
		return result.routeData ? { kind: 'resolved', route: result.routeData, warnings: result.warnings } : { kind: 'unavailable', warnings: result.warnings };
	},
	waypoints: (input) => resolveWaypoints(input),
	geojson: (input) => input === undefined ? { kind: 'unavailable', warnings: ['map-source-unsupported'] } : normalizeRouteGeometry(input),
	'brouter-web': () => ({ kind: 'unavailable', warnings: ['map-source-unsupported'] })
};

export class PathSourceRegistry {
	resolve(config: PathConfig, context: PathContext): PathResult | Promise<PathResult> {
		const adapter = adapters[config.source];
		return adapter(config.source === 'waypoints' ? config.waypoints : config.geojson, context);
	}
}

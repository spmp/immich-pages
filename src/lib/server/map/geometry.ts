import { MAX_ROUTE_VERTICES } from './auto-route';
import type { MapRoute, PathResult } from './types';

export const MAX_ROUTE_BYTES = 64 * 1024;
export const MAX_ROUTE_SEGMENTS = 64;

type Position = [number, number];

export function firstRoutePosition(route: MapRoute): Position {
	return route.type === 'LineString' ? route.coordinates[0] : route.coordinates[0][0];
}

export function lastRoutePosition(route: MapRoute): Position {
	return route.type === 'LineString' ? route.coordinates[route.coordinates.length - 1] : route.coordinates[route.coordinates.length - 1][route.coordinates[route.coordinates.length - 1].length - 1];
}

export function routeVertexCount(route: MapRoute): number {
	return route.type === 'LineString' ? route.coordinates.length : route.coordinates.reduce((count, segment) => count + segment.length, 0);
}

function position(value: unknown): value is Position {
	return Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part)) && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
}

function invalid(): PathResult { return { kind: 'unavailable', warnings: ['map-route-invalid'] }; }

function linesFromGeometry(value: unknown): Position[][] | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const geometry = value as { type?: unknown; coordinates?: unknown };
	if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2 && geometry.coordinates.every(position)) return [(geometry.coordinates as unknown[]).map((item) => [...(item as Position)] as Position)];
	if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0 && geometry.coordinates.every((line) => Array.isArray(line) && line.length >= 2 && line.every(position))) return (geometry.coordinates as unknown[][]).map((line) => line.map((item) => [...(item as Position)] as Position));
	return null;
}

function extract(value: unknown): Position[][] | null {
	const direct = linesFromGeometry(value);
	if (direct) return direct;
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const wrapped = value as { type?: unknown; geometry?: unknown; features?: unknown };
	if (wrapped.type === 'Feature') return extract(wrapped.geometry);
	if (wrapped.type !== 'FeatureCollection' || !Array.isArray(wrapped.features) || wrapped.features.length === 0) return null;
	const lines: Position[][] = [];
	for (const feature of wrapped.features) {
		if (!feature || typeof feature !== 'object' || Array.isArray(feature) || (feature as { type?: unknown }).type !== 'Feature') return null;
		const extracted = extract((feature as { geometry?: unknown }).geometry);
		if (!extracted) return null;
		lines.push(...extracted);
	}
	return lines.length ? lines : null;
}

export function normalizeRouteGeometry(input: unknown): PathResult {
	let value = input;
	if (typeof input === 'string') {
		if (new TextEncoder().encode(input).byteLength > MAX_ROUTE_BYTES) return invalid();
		try { value = JSON.parse(input); } catch { return invalid(); }
	}
	const lines = extract(value);
	if (!lines || lines.length > MAX_ROUTE_SEGMENTS) return invalid();
	const vertices = lines.reduce((total, line) => total + line.length, 0);
	if (vertices > MAX_ROUTE_VERTICES) return invalid();
	const route: MapRoute = lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines };
	return { kind: 'resolved', route, warnings: [] };
}

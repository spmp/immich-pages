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

function position(value: unknown): Position | null {
	if (!Array.isArray(value) || value.length < 2 || !value.every((part) => typeof part === 'number' && Number.isFinite(part))) return null;
	const [lon, lat] = value;
	return lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90 ? [lon, lat] : null;
}

function invalid(): PathResult { return { kind: 'unavailable', warnings: ['map-route-invalid'] }; }

function linesFromGeometry(value: unknown): Position[][] | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const geometry = value as { type?: unknown; coordinates?: unknown };
	if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
		const line = geometry.coordinates.map(position);
		if (line.every((item): item is Position => item !== null)) return [line];
	}
	if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0) {
		const lines = (geometry.coordinates as unknown[]).map((line) => Array.isArray(line) && line.length >= 2 ? line.map(position) : null);
		if (lines.every((line): line is Position[] => line !== null && line.every((item): item is Position => item !== null))) return lines;
	}
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

/**
 * Thin a line to at most `maxVertices` points by dropping the ones that carry least shape
 * (Douglas-Peucker, tolerance widened until it fits). Both ends are always kept, and every
 * surviving point is one of the originals, in order.
 *
 * A routed road has a vertex every few metres -- about 7 per kilometre measured against
 * brouter.de -- which a journey map never needs and a long trip cannot afford to ship. Thinning
 * is what lets the length of a route stop being a reason to refuse it.
 */
export function simplifyLine(coordinates: Position[], maxVertices: number): Position[] {
	if (coordinates.length <= maxVertices || maxVertices < 2) return coordinates;
	// Evenly thin anything enormous first, so memory and time stay bounded whatever a router returns.
	const working = coordinates.length > SIMPLIFY_WORKING_VERTICES ? decimate(coordinates, SIMPLIFY_WORKING_VERTICES) : coordinates;
	let tolerance = 0.00002; // about 2 m
	for (let attempt = 0; attempt < 24; attempt += 1) {
		const simplified = douglasPeucker(working, tolerance);
		// null: the line is pathological for this algorithm (see douglasPeucker); thin it evenly.
		if (!simplified) break;
		if (simplified.length <= maxVertices) return simplified;
		tolerance *= 2;
	}
	return decimate(working, maxVertices);
}

const SIMPLIFY_WORKING_VERTICES = 100_000;

function decimate(coordinates: Position[], count: number): Position[] {
	const last = coordinates.length - 1;
	return Array.from({ length: count }, (_, index) => coordinates[Math.round(index * last / (count - 1))]);
}

/**
 * Returns null instead of running long: this is near-linear on real roads but quadratic on a
 * line that zigzags at every vertex, and the input is whatever a remote router chose to send.
 */
function douglasPeucker(coordinates: Position[], tolerance: number): Position[] | null {
	let budget = coordinates.length * 64 + 1_000_000;
	const keep = new Uint8Array(coordinates.length);
	keep[0] = 1;
	keep[coordinates.length - 1] = 1;
	// Explicit stack: recursion depth on a long, straight-ish road would overflow the call stack.
	const stack: Array<[number, number]> = [[0, coordinates.length - 1]];
	const limit = tolerance * tolerance;
	while (stack.length) {
		const [first, last] = stack.pop()!;
		if (last - first < 2) continue;
		budget -= last - first;
		if (budget < 0) return null;
		const [ax, ay] = coordinates[first];
		const [bx, by] = coordinates[last];
		// Longitude degrees shrink with latitude; scale so "distance" means the same in both axes.
		const scale = Math.cos((ay + by) / 2 * Math.PI / 180);
		const dx = (bx - ax) * scale;
		const dy = by - ay;
		const length = dx * dx + dy * dy;
		let worst = -1;
		let index = -1;
		for (let cursor = first + 1; cursor < last; cursor += 1) {
			const px = (coordinates[cursor][0] - ax) * scale;
			const py = coordinates[cursor][1] - ay;
			const t = length === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / length));
			const ex = px - t * dx;
			const ey = py - t * dy;
			const distance = ex * ex + ey * ey;
			if (distance > worst) { worst = distance; index = cursor; }
		}
		if (worst > limit) { keep[index] = 1; stack.push([first, index], [index, last]); }
	}
	return coordinates.filter((_, index) => keep[index] === 1);
}

export function normalizeRouteGeometry(input: unknown, maxVertices = MAX_ROUTE_VERTICES): PathResult {
	let value = input;
	if (typeof input === 'string') {
		if (new TextEncoder().encode(input).byteLength > MAX_ROUTE_BYTES) return invalid();
		try { value = JSON.parse(input); } catch { return invalid(); }
	}
	const lines = extract(value);
	if (!lines || lines.length > MAX_ROUTE_SEGMENTS) return invalid();
	const vertices = lines.reduce((total, line) => total + line.length, 0);
	if (vertices > maxVertices) return invalid();
	const route: MapRoute = lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines };
	return { kind: 'resolved', route, warnings: [] };
}

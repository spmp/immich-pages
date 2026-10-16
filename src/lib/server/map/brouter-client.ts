import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { BRouterWebParseResult } from './brouter-web';
import { normalizeRouteGeometry, simplifyLine } from './geometry';
import { BrouterLruCache } from './brouter-cache';
import type { MapRoute, MapWarning, PathResult } from './types';

// None of these limits may be a proxy for "how long is the road": a multi-day road trip is the
// normal case for a journey page, not an abuse case. Measured against brouter.de (2026-10-13), a
// car route is about 0.47 KB and 7 vertices per kilometre, and a 593 km leg takes about 5 s. The
// old 256 KB / 8 s per-leg limits therefore topped out near 550 km, which is what took the route
// off a production page with a Phoenix -> San Diego leg. What is actually being bounded:
//
//   * bytes buffered from one untrusted response      -> MAX_RESPONSE_BYTES (4 MB ~ 8,500 km/leg)
//   * vertices parsed before thinning                  -> MAX_BROUTER_RAW_VERTICES
//   * vertices kept, cached and sent to the browser    -> MAX_BROUTER_ROUTE_VERTICES (thinned to
//     fit, never rejected for exceeding it)
//   * how long one page load waits                     -> BROUTER_MAX_TOTAL_MS
//   * how long resolution may run in the background    -> ROUTE_WORK_BUDGET_MS
export const DEFAULT_BROUTER_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_BROUTER_RESPONSE_BYTES = 16 * 1024 * 1024;
export const MAX_BROUTER_ROUTE_VERTICES = 10_000;
const MAX_BROUTER_RAW_VERTICES = 1_000_000;
// Silence on the socket, not total duration: the router sends nothing until a leg is computed.
const REQUEST_TIMEOUT_MS = 30_000;
// brouter-web itself requests legs in parallel; a few at a time keeps a 250-waypoint trip to
// minutes rather than tens of minutes without leaning on a shared public router.
const SEGMENT_CONCURRENCY = 4;
const ROUTE_WORK_BUDGET_MS = 5 * 60_000;
// A refusal or malformed reply will not change by asking again at once; a timeout or a failed
// connection might. Either way the router is not asked again on every single page load.
const ROUTE_FAILURE_TTL_MS = 5 * 60_000;
const ROUTE_TRANSIENT_FAILURE_TTL_MS = 30_000;
const transientWarnings = new Set<MapWarning>(['brouter-timeout', 'brouter-request-failed']);

function positiveEnv(name: string, fallback: number, maximum: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? Math.min(Math.trunc(value), maximum) : fallback;
}

/**
 * How long a resolved route and its legs are kept. One knob for everything Pages caches in
 * memory: this is the HDR cache's HDR_CACHE_TTL_MS, with the same default (10 minutes) and
 * ceiling (24 hours) as hdr-cache.ts. Parsed here rather than imported so the map code does not
 * pull in the media pipeline, and read per call so it follows the environment like the other
 * BROUTER_* settings do.
 */
export function brouterCacheTtlMs(): number {
	return positiveEnv('HDR_CACHE_TTL_MS', 10 * 60 * 1000, 24 * 60 * 60 * 1000);
}

// How long ONE PAGE LOAD waits for a route before rendering the map without it. This does not
// stop the resolution: it carries on (see ROUTE_WORK_BUDGET_MS) and is cached for the next load,
// so a route that needs longer than this is late once rather than missing for every visitor.
export const DEFAULT_BROUTER_MAX_TOTAL_MS = 15_000;
export const MAX_BROUTER_MAX_TOTAL_MS = 60_000;
type Address = { address: string; family: 4 | 6 };
export type BrouterLookup = (hostname: string, options?: { all?: boolean; verbatim?: boolean }) => Promise<Address[]>;
type ClientOptions = { endpoint: string; allowedOrigins: string[]; lookup?: BrouterLookup; allowLoopbackForTests?: boolean };
const defaultLookup: BrouterLookup = async (hostname) => dns.lookup(hostname, { all: true, verbatim: true }) as Promise<Address[]>;
const vertexCount = (route: MapRoute) => route.type === 'LineString' ? route.coordinates.length : route.coordinates.reduce((count, line) => count + line.length, 0);
// Legs: kept so a route that ran out of time resumes where it stopped, and so journeys that
// share legs share the work. Bounded by vertices held, since legs vary from metres to a day's drive.
const routeCache = new BrouterLruCache<MapRoute>({ maxEntries: 4096, maxWeight: 1_000_000, weigh: vertexCount });
const inFlight = new Map<string, Promise<PathResult>>();
// Whole routes, success or failure, keyed by what actually determines the road: the router
// endpoint, the profile and the ordered waypoints. The permalink's map view is not part of it.
const resultCache = new BrouterLruCache<PathResult>({ maxEntries: 256, maxWeight: 2_000_000, weigh: (result) => result.kind === 'resolved' ? vertexCount(result.route) : 1 });
const routesInFlight = new Map<string, Promise<PathResult>>();

export function resetBrouterCachesForTests(): void {
	routeCache.clear();
	resultCache.clear();
	inFlight.clear();
	routesInFlight.clear();
}

function thinRoute(route: MapRoute, maxVertices: number): MapRoute {
	if (vertexCount(route) <= maxVertices) return route;
	if (route.type === 'LineString') return { type: 'LineString', coordinates: simplifyLine(route.coordinates, maxVertices) };
	const share = Math.max(2, Math.floor(maxVertices / route.coordinates.length));
	return { type: 'MultiLineString', coordinates: route.coordinates.map((line) => simplifyLine(line, share)) };
}

export function parseBrouterMaxResponseBytes(value: string | undefined): number {
	if (!value || !/^\d+$/.test(value)) return DEFAULT_BROUTER_MAX_RESPONSE_BYTES;
	const bytes = Number(value);
	return Number.isSafeInteger(bytes) && bytes >= 64 * 1024 && bytes <= MAX_BROUTER_RESPONSE_BYTES ? bytes : DEFAULT_BROUTER_MAX_RESPONSE_BYTES;
}

const unavailable = (warning: MapWarning): PathResult => ({ kind: 'unavailable', warnings: [warning] });
export type BrouterEndpointValidation =
	| { kind: 'resolved'; endpoint: URL; addresses: Address[] }
	| { kind: 'unavailable'; warnings: ['brouter-endpoint-unsafe'] };

function unsafeAddress(address: string, allowLoopback: boolean): boolean {
	const ip = net.isIP(address);
	if (!ip) return true;
	if (ip === 4) {
		const octets = address.split('.').map(Number);
		const [a, b] = octets;
		return (a === 127 && !allowLoopback) || a === 0 || a >= 224 || a === 10 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
	}
	const normalized = address.toLowerCase();
	if (normalized === '::1' || normalized === '::' || normalized.startsWith('ff') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || /^[fc][0-9a-f]/.test(normalized)) return !allowLoopback || normalized !== '::1';
	if (normalized.startsWith('::ffff:')) return unsafeAddress(normalized.slice(7), allowLoopback);
	return false;
}

function endpointPolicy(endpointValue: string, allowedOrigins: string[], allowLoopback: boolean): URL | null {
	let endpoint: URL;
	try { endpoint = new URL(endpointValue); } catch { return null; }
	if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !endpoint.hostname || endpoint.port && !['80', '443'].includes(endpoint.port) && !allowLoopback) return null;
	if (/%/.test(endpointValue) || net.isIP(endpoint.hostname) && unsafeAddress(endpoint.hostname, allowLoopback)) return null;
	const allowed = allowedOrigins.some((candidate) => {
		try {
			const parsed = new URL(candidate);
			return parsed.protocol === endpoint.protocol && parsed.origin === endpoint.origin && (parsed.pathname === '/' || parsed.pathname === endpoint.pathname);
		} catch { return false; }
	});
	return allowed ? endpoint : null;
}

function sameAnswers(first: Address[], second: Address[]): boolean {
	const a = first.map(({ address, family }) => `${address}/${family}`).sort();
	const b = second.map(({ address, family }) => `${address}/${family}`).sort();
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

export async function validateBrouterEndpoint(endpoint: string, allowedOrigins: string[], resolver: BrouterLookup = defaultLookup, allowLoopbackForTests = false): Promise<BrouterEndpointValidation> {
	const url = endpointPolicy(endpoint, allowedOrigins, allowLoopbackForTests);
	if (!url) return { kind: 'unavailable', warnings: ['brouter-endpoint-unsafe'] };
	try {
		const addresses = await resolver(url.hostname, { all: true, verbatim: true });
		if (!addresses.length || addresses.some(({ address }) => unsafeAddress(address, allowLoopbackForTests))) return { kind: 'unavailable', warnings: ['brouter-endpoint-unsafe'] };
		return { kind: 'resolved', endpoint: url, addresses };
	} catch { return { kind: 'unavailable', warnings: ['brouter-endpoint-unsafe'] }; }
}

export class BrouterClient {
	private readonly options: Required<Pick<ClientOptions, 'endpoint' | 'allowedOrigins' | 'allowLoopbackForTests'>> & { lookup: BrouterLookup };
	constructor(options: ClientOptions) {
		this.options = { ...options, lookup: options.lookup ?? defaultLookup, allowLoopbackForTests: options.allowLoopbackForTests ?? false };
	}

	async resolve(parsed: Extract<BRouterWebParseResult, { kind: 'resolved' }>): Promise<PathResult> {
		const endpoint = endpointPolicy(this.options.endpoint, this.options.allowedOrigins, this.options.allowLoopbackForTests);
		if (!endpoint) return unavailable('brouter-endpoint-unsafe');
		let addresses: Address[];
		try { addresses = await this.options.lookup(endpoint.hostname, { all: true, verbatim: true }); } catch { return unavailable('brouter-endpoint-unsafe'); }
		if (!addresses.length || addresses.some(({ address }) => unsafeAddress(address, this.options.allowLoopbackForTests))) return unavailable('brouter-endpoint-unsafe');
		const fresh = await this.options.lookup(endpoint.hostname, { all: true, verbatim: true }).catch(() => []);
		if (!sameAnswers(addresses, fresh) || fresh.some(({ address }) => unsafeAddress(address, this.options.allowLoopbackForTests))) return unavailable('brouter-endpoint-unsafe');
		const cacheEnabled = process.env.BROUTER_CACHE_ENABLED !== 'false';
		const routeKey = `${endpoint.origin}${endpoint.pathname}|${parsed.profile}|${parsed.waypoints.map(([lon, lat]) => `${lon},${lat}`).join(';')}`;
		const withWarnings = (result: PathResult): PathResult => result.kind === 'resolved' ? { ...result, warnings: [...parsed.warnings, ...result.warnings] } : result;
		const cached = cacheEnabled ? resultCache.get(routeKey) : undefined;
		if (cached) return withWarnings(cached);

		let work = cacheEnabled ? routesInFlight.get(routeKey) : undefined;
		if (!work) {
			work = this.resolveRoute(parsed, endpoint, addresses[0], cacheEnabled).then((result) => {
				// A failure is never remembered for longer than a success would be.
				const ttlMs = brouterCacheTtlMs();
				if (cacheEnabled) resultCache.set(routeKey, result, Date.now(), result.kind === 'resolved' ? ttlMs : Math.min(ttlMs, result.warnings.some((warning) => transientWarnings.has(warning)) ? ROUTE_TRANSIENT_FAILURE_TTL_MS : ROUTE_FAILURE_TTL_MS));
				return result;
			}).finally(() => { if (routesInFlight.get(routeKey) === work) routesInFlight.delete(routeKey); });
			if (cacheEnabled) routesInFlight.set(routeKey, work);
		}
		// The page waits this long and no longer; the work itself is not cancelled.
		const waitMs = positiveEnv('BROUTER_MAX_TOTAL_MS', DEFAULT_BROUTER_MAX_TOTAL_MS, MAX_BROUTER_MAX_TOTAL_MS);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const waited = new Promise<PathResult>((resolve) => { timer = setTimeout(() => resolve(unavailable('brouter-timeout')), waitMs); });
		try { return withWarnings(await Promise.race([work, waited])); } finally { clearTimeout(timer); }
	}

	/** Fetch every leg, a few at a time, and join them into one thinned line. */
	private async resolveRoute(parsed: Extract<BRouterWebParseResult, { kind: 'resolved' }>, endpoint: URL, pinned: Address, cacheEnabled: boolean): Promise<PathResult> {
		const deadline = Date.now() + ROUTE_WORK_BUDGET_MS;
		const maxResponseBytes = parseBrouterMaxResponseBytes(process.env.BROUTER_MAX_RESPONSE_BYTES);
		const legCount = parsed.waypoints.length - 1;
		const legs: Array<PathResult | undefined> = Array.from({ length: legCount });
		let next = 0;
		let failed = false;
		const worker = async () => {
			// One leg failing makes the route unusable, so stop starting new ones; legs already
			// resolved stay in the leg cache for the next attempt.
			while (!failed && next < legCount) {
				const index = next;
				next += 1;
				if (Date.now() >= deadline) { legs[index] = unavailable('brouter-timeout'); failed = true; return; }
				const [from, to] = [parsed.waypoints[index], parsed.waypoints[index + 1]];
				const url = new URL(endpoint);
				url.search = `?lonlats=${from[0]},${from[1]}|${to[0]},${to[1]}&profile=${encodeURIComponent(parsed.profile)}&alternativeidx=0&format=geojson`;
				const cacheKey = `${endpoint.origin}${endpoint.pathname}|${parsed.profile}|${from[0]},${from[1]}|${to[0]},${to[1]}`;
				const cachedLeg = cacheEnabled ? routeCache.get(cacheKey) : undefined;
				const leg = cachedLeg ? { kind: 'resolved' as const, route: cachedLeg, warnings: [] } : await this.resolveSegment(cacheKey, url, pinned, maxResponseBytes, cacheEnabled, deadline);
				legs[index] = leg;
				if (leg.kind !== 'resolved') failed = true;
			}
		};
		await Promise.all(Array.from({ length: Math.min(SEGMENT_CONCURRENCY, legCount) }, worker));
		const coordinates: Array<[number, number]> = [];
		// Each leg's own end points are kept through thinning, so the line still passes through
		// every waypoint the author placed.
		const joints = new Set<[number, number]>();
		for (const leg of legs) {
			if (!leg) return unavailable('brouter-timeout');
			if (leg.kind !== 'resolved') return leg;
			const legCoordinates = leg.route.type === 'LineString' ? leg.route.coordinates : leg.route.coordinates.flat();
			const previous = coordinates[coordinates.length - 1];
			const continued = previous && previous[0] === legCoordinates[0][0] && previous[1] === legCoordinates[0][1] ? legCoordinates.slice(1) : legCoordinates;
			for (const point of continued) coordinates.push(point);
			joints.add(coordinates[coordinates.length - 1]);
		}
		if (coordinates.length < 2) return unavailable('brouter-response-invalid');
		if (coordinates.length <= MAX_BROUTER_ROUTE_VERTICES) return { kind: 'resolved', route: { type: 'LineString', coordinates }, warnings: [] };
		// Thin each stretch between waypoints to its share of the budget, so a long motorway leg
		// gives up redundant points before a short, twisty one gives up shape.
		const thinned: Array<[number, number]> = [coordinates[0]];
		const budget = Math.max(2, Math.floor(MAX_BROUTER_ROUTE_VERTICES * 0.98));
		let start = 0;
		for (let index = 1; index < coordinates.length; index += 1) {
			if (!joints.has(coordinates[index]) && index !== coordinates.length - 1) continue;
			const stretch = coordinates.slice(start, index + 1);
			const share = Math.max(2, Math.floor(budget * stretch.length / coordinates.length));
			for (const point of simplifyLine(stretch, share).slice(1)) thinned.push(point);
			start = index;
		}
		return { kind: 'resolved', route: { type: 'LineString', coordinates: thinned.length <= MAX_BROUTER_ROUTE_VERTICES ? thinned : simplifyLine(thinned, MAX_BROUTER_ROUTE_VERTICES) }, warnings: [] };
	}

	private resolveSegment(key: string, url: URL, pinned: Address, maxResponseBytes: number, cacheEnabled: boolean, deadline: number): Promise<PathResult> {
		if (!cacheEnabled) return this.request(url, pinned, maxResponseBytes, deadline);
		const existing = inFlight.get(key);
		if (existing) return existing;
		const request = this.request(url, pinned, maxResponseBytes, deadline).then((result) => {
			if (result.kind === 'resolved') routeCache.set(key, result.route, Date.now(), brouterCacheTtlMs());
			return result;
		}).finally(() => inFlight.delete(key));
		inFlight.set(key, request);
		return request;
	}

	private request(url: URL, pinned: Address, maxResponseBytes: number, deadline: number): Promise<PathResult> {
		return new Promise((resolve) => {
			const transport = url.protocol === 'https:' ? https : http;
			let settled = false;
			let hardStop: ReturnType<typeof setTimeout> | undefined;
			const finish = (result: PathResult) => { if (!settled) { settled = true; clearTimeout(hardStop); resolve(result); } };
			const request = transport.request(url, { method: 'GET', headers: url.origin === 'https://brouter.de' ? { referer: 'https://brouter.de/brouter-web/' } : {}, timeout: REQUEST_TIMEOUT_MS, servername: url.hostname, lookup: (_host, options, callback) => options.all ? callback(null, [{ address: pinned.address, family: pinned.family }]) : callback(null, pinned.address, pinned.family) }, (response) => {
				if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) { response.resume(); finish(unavailable('brouter-request-failed')); return; }
				if (response.statusCode !== 200) { response.resume(); finish(unavailable(response.statusCode === 400 ? 'brouter-route-rejected' : 'brouter-request-failed')); return; }
				const contentType = response.headers['content-type'];
				if (contentType && !String(contentType).toLowerCase().includes('json')) { response.resume(); finish(unavailable('brouter-response-invalid')); return; }
				const chunks: Buffer[] = []; let size = 0;
				response.on('data', (chunk: Buffer | string) => { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.byteLength; if (size > maxResponseBytes) { response.destroy(); finish(unavailable('brouter-response-too-large')); } else chunks.push(buffer); });
				response.on('end', () => { try { const result = normalizeRouteGeometry(JSON.parse(Buffer.concat(chunks).toString('utf8')), MAX_BROUTER_RAW_VERTICES); finish(result.kind === 'resolved' ? { ...result, route: thinRoute(result.route, MAX_BROUTER_ROUTE_VERTICES) } : unavailable('brouter-response-invalid')); } catch { finish(unavailable('brouter-response-invalid')); } });
				response.on('error', () => finish(unavailable('brouter-response-invalid')));
			});
			request.on('timeout', () => { request.destroy(); finish(unavailable('brouter-timeout')); });
			// The idle timeout above cannot stop a reply that trickles in; the route's own
			// deadline can.
			hardStop = setTimeout(() => { request.destroy(); finish(unavailable('brouter-timeout')); }, Math.max(0, deadline - Date.now()));
			request.on('error', () => finish(unavailable('brouter-request-failed')));
			request.end();
		});
	}
}

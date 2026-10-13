import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { BRouterWebParseResult } from './brouter-web';
import { normalizeRouteGeometry } from './geometry';
import { BrouterLruCache } from './brouter-cache';
import type { MapWarning, PathResult } from './types';

export const DEFAULT_BROUTER_MAX_RESPONSE_BYTES = 256 * 1024;
export const MAX_BROUTER_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_BROUTER_ROUTE_VERTICES = 10_000;
const REQUEST_TIMEOUT_MS = 8_000;

function positiveEnv(name: string, fallback: number, maximum: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? Math.min(Math.trunc(value), maximum) : fallback;
}

// Real-backend UAT (2026-10-12): resolve() processes waypoints sequentially, each segment with
// its OWN up-to-REQUEST_TIMEOUT_MS budget -- a route with many waypoints (now capped, but still
// up to MAX_BROUTER_WAYPOINTS-1 segments) had no OVERALL ceiling, so the per-segment timeout
// alone could not bound total page-assembly latency. This caps the whole resolve() call.
export const DEFAULT_BROUTER_MAX_TOTAL_MS = 15_000;
export const MAX_BROUTER_MAX_TOTAL_MS = 60_000;
type Address = { address: string; family: 4 | 6 };
export type BrouterLookup = (hostname: string, options?: { all?: boolean; verbatim?: boolean }) => Promise<Address[]>;
type ClientOptions = { endpoint: string; allowedOrigins: string[]; lookup?: BrouterLookup; allowLoopbackForTests?: boolean };
const defaultLookup: BrouterLookup = async (hostname) => dns.lookup(hostname, { all: true, verbatim: true }) as Promise<Address[]>;
const routeCache = new BrouterLruCache();
const inFlight = new Map<string, Promise<PathResult>>();

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
		const totalBudgetMs = positiveEnv('BROUTER_MAX_TOTAL_MS', DEFAULT_BROUTER_MAX_TOTAL_MS, MAX_BROUTER_MAX_TOTAL_MS);
		const deadline = Date.now() + totalBudgetMs;
		const coordinates: Array<[number, number]> = [];
		for (let index = 0; index < parsed.waypoints.length - 1; index += 1) {
			// Checked BEFORE starting each new segment, not just once -- a route with many
			// waypoints must degrade gracefully once the aggregate budget is spent, rather than
			// attempting one more up-to-8s segment past it on every subsequent poll.
			if (Date.now() >= deadline) return unavailable('brouter-timeout');
			const [from, to] = [parsed.waypoints[index], parsed.waypoints[index + 1]];
			const lonlats = `${from[0]},${from[1]}|${to[0]},${to[1]}`;
			endpoint.search = `?lonlats=${lonlats}&profile=${encodeURIComponent(parsed.profile)}&alternativeidx=0&format=geojson`;
			const cacheEnabled = process.env.BROUTER_CACHE_ENABLED !== 'false';
			const cacheKey = `${endpoint.origin}${endpoint.pathname}|${parsed.profile}|${from[0]},${from[1]}|${to[0]},${to[1]}`;
			const cached = cacheEnabled ? routeCache.get(cacheKey) : undefined;
			const segment = cached ? { kind: 'resolved' as const, route: cached, warnings: [] } : await this.resolveSegment(cacheKey, endpoint, addresses[0], parseBrouterMaxResponseBytes(process.env.BROUTER_MAX_RESPONSE_BYTES), cacheEnabled);
			if (segment.kind !== 'resolved') return segment;
			const segmentCoordinates = segment.route.type === 'LineString' ? segment.route.coordinates : segment.route.coordinates.flat();
			coordinates.push(...(coordinates.length > 0 && coordinates[coordinates.length - 1][0] === segmentCoordinates[0][0] && coordinates[coordinates.length - 1][1] === segmentCoordinates[0][1] ? segmentCoordinates.slice(1) : segmentCoordinates));
		}
		const route = normalizeRouteGeometry({ type: 'LineString', coordinates }, MAX_BROUTER_ROUTE_VERTICES);
		return route.kind === 'resolved' ? { ...route, warnings: [...parsed.warnings, ...route.warnings] } : route;
	}

	private resolveSegment(key: string, url: URL, pinned: Address, maxResponseBytes: number, cacheEnabled: boolean): Promise<PathResult> {
		if (!cacheEnabled) return this.request(url, pinned, maxResponseBytes);
		const existing = inFlight.get(key);
		if (existing) return existing;
		const request = this.request(url, pinned, maxResponseBytes).then((result) => {
			if (result.kind === 'resolved') routeCache.set(key, result.route);
			return result;
		}).finally(() => inFlight.delete(key));
		inFlight.set(key, request);
		return request;
	}

	private request(url: URL, pinned: Address, maxResponseBytes: number): Promise<PathResult> {
		return new Promise((resolve) => {
			const transport = url.protocol === 'https:' ? https : http;
			let settled = false;
			const finish = (result: PathResult) => { if (!settled) { settled = true; resolve(result); } };
			const request = transport.request(url, { method: 'GET', headers: url.origin === 'https://brouter.de' ? { referer: 'https://brouter.de/brouter-web/' } : {}, timeout: REQUEST_TIMEOUT_MS, servername: url.hostname, lookup: (_host, options, callback) => options.all ? callback(null, [{ address: pinned.address, family: pinned.family }]) : callback(null, pinned.address, pinned.family) }, (response) => {
				if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) { response.resume(); finish(unavailable('brouter-request-failed')); return; }
				if (response.statusCode !== 200) { response.resume(); finish(unavailable(response.statusCode === 400 ? 'brouter-route-rejected' : 'brouter-request-failed')); return; }
				const contentType = response.headers['content-type'];
				if (contentType && !String(contentType).toLowerCase().includes('json')) { response.resume(); finish(unavailable('brouter-response-invalid')); return; }
				const chunks: Buffer[] = []; let size = 0;
				response.on('data', (chunk: Buffer | string) => { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.byteLength; if (size > maxResponseBytes) { response.destroy(); finish(unavailable('brouter-response-too-large')); } else chunks.push(buffer); });
				response.on('end', () => { try { const result = normalizeRouteGeometry(JSON.parse(Buffer.concat(chunks).toString('utf8')), MAX_BROUTER_ROUTE_VERTICES); finish(result.kind === 'resolved' ? result : unavailable('brouter-response-invalid')); } catch { finish(unavailable('brouter-response-invalid')); } });
				response.on('error', () => finish(unavailable('brouter-response-invalid')));
			});
			request.on('timeout', () => { request.destroy(); finish(unavailable('brouter-timeout')); });
			request.on('error', () => finish(unavailable('brouter-request-failed')));
			request.end();
		});
	}
}

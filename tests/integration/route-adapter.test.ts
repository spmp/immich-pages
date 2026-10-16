import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { beforeEach } from 'vitest';
import { BrouterClient, brouterCacheTtlMs, DEFAULT_BROUTER_MAX_RESPONSE_BYTES, MAX_BROUTER_ROUTE_VERTICES, parseBrouterMaxResponseBytes, resetBrouterCachesForTests } from '../../src/lib/server/map/brouter-client';
import { parseBrouterWebPermalink } from '../../src/lib/server/map/brouter-web';
import { PathSourceRegistry, resolveWaypoints } from '../../src/lib/server/map/path-adapters';

const parsed = parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=1,2%7C3,4%7C5,6&profile=trekking');
if (parsed.kind !== 'resolved') throw new Error('fixture permalink did not parse');
const twoPointParsed = parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=7,8%7C9,10&profile=trekking');
if (twoPointParsed.kind !== 'resolved') throw new Error('two-point fixture permalink did not parse');

async function fixtureServer(handler: (profile: string | null, request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void) {
  const server = createServer((request, response) => handler(new URL(request.url ?? '/', 'http://fixture').searchParams.get('profile'), request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not start');
  return { server, endpoint: `http://127.0.0.1:${address.port}/brouter`, origin: `http://127.0.0.1:${address.port}` };
}

const loopbackClient = (fixture: { endpoint: string; origin: string }) => new BrouterClient({ endpoint: fixture.endpoint, allowedOrigins: [fixture.origin], allowLoopbackForTests: true, lookup: async () => [{ address: '127.0.0.1', family: 4 }] });

/** A BRouter-shaped reply for the leg named in the request: `vertices` points along it, 3D like the real thing, padded to `padBytes`. */
function legResponse(requestUrl: string | undefined, vertices: number, padBytes = 0): string {
	const [from, to] = (new URL(requestUrl ?? '/', 'http://fixture').searchParams.get('lonlats') ?? '').split('|').map((pair) => pair.split(',').map(Number));
	const coordinates = Array.from({ length: vertices }, (_, index) => {
		const t = index / (vertices - 1);
		const wiggle = index === 0 || index === vertices - 1 ? 0 : Math.sin(index / 7) * 0.01;
		return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t + wiggle, 350];
	});
	return JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { 'track-length': '593101', messages: 'x'.repeat(padBytes) }, geometry: { type: 'LineString', coordinates } }] });
}

describe('BRouter route adapter boundary', () => {
	beforeEach(() => resetBrouterCachesForTests());

	it('bounds the configurable response limit', () => {
		expect(DEFAULT_BROUTER_MAX_RESPONSE_BYTES).toBe(4 * 1024 * 1024);
		expect(parseBrouterMaxResponseBytes(undefined)).toBe(DEFAULT_BROUTER_MAX_RESPONSE_BYTES);
		expect(parseBrouterMaxResponseBytes('1048576')).toBe(1048576);
		expect(parseBrouterMaxResponseBytes('65535')).toBe(DEFAULT_BROUTER_MAX_RESPONSE_BYTES);
		expect(parseBrouterMaxResponseBytes('17000000')).toBe(DEFAULT_BROUTER_MAX_RESPONSE_BYTES);
		expect(parseBrouterMaxResponseBytes('not-a-number')).toBe(DEFAULT_BROUTER_MAX_RESPONSE_BYTES);
	});

	// Production failure (2026-10-13): a journey with a Phoenix -> San Diego leg showed no route.
	// Measured against brouter.de, that one 593 km leg is a 276 KB reply with 3,349 vertices --
	// over the old 256 KB per-leg limit, so the whole route was thrown away as "too large". The
	// length of road in a leg must not decide whether a route can be shown.
	it('resolves a route whose legs are hundreds of kilometres of road', async () => {
		const longDrive = parseBrouterWebPermalink('https://brouter.de/brouter-web/#map=9/32.8574/-113.8333/standard&lonlats=-112.002504,33.538406;-117.255275,32.736727;-111.999435,33.435862&profile=car-eco');
		if (longDrive.kind !== 'resolved') throw new Error('fixture permalink did not parse');
		const fixture = await fixtureServer((_profile, request, response) => {
			response.writeHead(200, { 'content-type': 'application/vnd.geo+json' });
			response.end(legResponse(request.url, 3_349, 180_000));
		});
		try {
			const result = await loopbackClient(fixture).resolve(longDrive);
			expect(result.kind).toBe('resolved');
			if (result.kind !== 'resolved' || result.route.type !== 'LineString') throw new Error('expected a single resolved line');
			expect(result.route.coordinates[0]).toEqual([-112.002504, 33.538406]);
			expect(result.route.coordinates.at(-1)).toEqual([-111.999435, 33.435862]);
			expect(result.route.coordinates.length).toBeGreaterThan(1_000);
		} finally { fixture.server.close(); }
	});

	// The next failure waiting behind that one: a longer journey has more vertices than the map
	// payload allows. That used to discard the route as invalid; it must be thinned instead.
	it('thins a route with far more vertices than the map needs instead of rejecting it', async () => {
		const crossCountry = parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=-122.4,37.8;-104.9,39.7;-87.6,41.9;-74.0,40.7&profile=car-eco');
		if (crossCountry.kind !== 'resolved') throw new Error('fixture permalink did not parse');
		const fixture = await fixtureServer((_profile, request, response) => {
			response.writeHead(200, { 'content-type': 'application/vnd.geo+json' });
			response.end(legResponse(request.url, 30_000));
		});
		try {
			const result = await loopbackClient(fixture).resolve(crossCountry);
			if (result.kind !== 'resolved' || result.route.type !== 'LineString') throw new Error(`expected a resolved line, got ${JSON.stringify(result).slice(0, 120)}`);
			expect(result.route.coordinates.length).toBeLessThanOrEqual(MAX_BROUTER_ROUTE_VERTICES);
			expect(result.route.coordinates.length).toBeGreaterThan(1_000);
			expect(result.route.coordinates[0]).toEqual([-122.4, 37.8]);
			expect(result.route.coordinates.at(-1)).toEqual([-74.0, 40.7]);
			// Thinned, not truncated: every leg's own end point is still on the line.
			for (const stop of [[-104.9, 39.7], [-87.6, 41.9]]) expect(result.route.coordinates).toContainEqual(stop);
		} finally { fixture.server.close(); }
	});

	it('requests legs a few at a time rather than one after another', async () => {
		const tour = parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=1,1;2,2;3,3;4,4;5,5;6,6;7,7;8,8;9,9;10,10;11,11&profile=trekking');
		if (tour.kind !== 'resolved') throw new Error('fixture permalink did not parse');
		let open = 0;
		let peak = 0;
		const fixture = await fixtureServer((_profile, request, response) => {
			open += 1;
			peak = Math.max(peak, open);
			setTimeout(() => { open -= 1; response.writeHead(200, { 'content-type': 'application/geo+json' }); response.end(legResponse(request.url, 2)); }, 25);
		});
		try {
			const result = await loopbackClient(fixture).resolve(tour);
			expect(result).toMatchObject({ kind: 'resolved' });
			if (result.kind === 'resolved' && result.route.type === 'LineString') expect(result.route.coordinates).toEqual(Array.from({ length: 11 }, (_, index) => [index + 1, index + 1]));
			expect(peak).toBeGreaterThan(1);
			expect(peak).toBeLessThanOrEqual(4);
		} finally { fixture.server.close(); }
	});

	it('caches the whole route by endpoint, profile and waypoints, ignoring the permalink\'s map view', async () => {
		const first = parseBrouterWebPermalink('https://brouter.de/brouter-web/#map=9/32.8/-113.8/standard&lonlats=21,22;23,24;25,26&profile=trekking');
		const sameRouteOtherView = parseBrouterWebPermalink('https://brouter.de/brouter-web/#map=14/10.0/20.0/osm-mapnik-german_style&lonlats=21,22;23,24;25,26&profile=trekking');
		const otherProfile = parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=21,22;23,24;25,26&profile=fastbike');
		if (first.kind !== 'resolved' || sameRouteOtherView.kind !== 'resolved' || otherProfile.kind !== 'resolved') throw new Error('fixture permalink did not parse');
		const requests: string[] = [];
		const fixture = await fixtureServer((_profile, request, response) => {
			requests.push(request.url ?? '');
			response.writeHead(200, { 'content-type': 'application/geo+json' });
			response.end(legResponse(request.url, 2));
		});
		try {
			const one = await loopbackClient(fixture).resolve(first);
			const two = await loopbackClient(fixture).resolve(sameRouteOtherView);
			expect(requests).toHaveLength(2);
			expect(two).toEqual(one);
			await loopbackClient(fixture).resolve(otherProfile);
			expect(requests).toHaveLength(4);
		} finally { fixture.server.close(); }
	});

	// One lifetime knob for everything Pages caches in memory: the HDR cache's HDR_CACHE_TTL_MS
	// (default 10 minutes, at most 24 hours) also decides how long a resolved route is kept.
	it('keeps a resolved route for HDR_CACHE_TTL_MS, then asks the router again', async () => {
		const route = parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=41,42;43,44&profile=trekking');
		if (route.kind !== 'resolved') throw new Error('fixture permalink did not parse');
		const requests: string[] = [];
		const fixture = await fixtureServer((_profile, request, response) => {
			requests.push(request.url ?? '');
			response.writeHead(200, { 'content-type': 'application/geo+json' });
			response.end(legResponse(request.url, 2));
		});
		const previous = process.env.HDR_CACHE_TTL_MS;
		process.env.HDR_CACHE_TTL_MS = '60';
		try {
			await loopbackClient(fixture).resolve(route);
			await loopbackClient(fixture).resolve(route);
			expect(requests).toHaveLength(1);
			await new Promise((resolve) => setTimeout(resolve, 90));
			expect(await loopbackClient(fixture).resolve(route)).toMatchObject({ kind: 'resolved' });
			expect(requests).toHaveLength(2);
		} finally {
			if (previous === undefined) delete process.env.HDR_CACHE_TTL_MS;
			else process.env.HDR_CACHE_TTL_MS = previous;
			fixture.server.close();
		}
	});

	it('uses the HDR cache\'s own default and ceiling when the lifetime is unset or out of range', () => {
		const previous = process.env.HDR_CACHE_TTL_MS;
		try {
			delete process.env.HDR_CACHE_TTL_MS;
			expect(brouterCacheTtlMs()).toBe(10 * 60 * 1000);
			process.env.HDR_CACHE_TTL_MS = '3600000';
			expect(brouterCacheTtlMs()).toBe(3_600_000);
			process.env.HDR_CACHE_TTL_MS = String(7 * 24 * 60 * 60 * 1000);
			expect(brouterCacheTtlMs()).toBe(24 * 60 * 60 * 1000);
			process.env.HDR_CACHE_TTL_MS = 'soon';
			expect(brouterCacheTtlMs()).toBe(10 * 60 * 1000);
		} finally {
			if (previous === undefined) delete process.env.HDR_CACHE_TTL_MS;
			else process.env.HDR_CACHE_TTL_MS = previous;
		}
	});

	it('does not ask the router again straight away for a route it has just refused', async () => {
		const refused = parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=31,32;33,34&profile=trekking');
		if (refused.kind !== 'resolved') throw new Error('fixture permalink did not parse');
		const requests: string[] = [];
		const fixture = await fixtureServer((_profile, request, response) => { requests.push(request.url ?? ''); response.writeHead(400); response.end(); });
		try {
			expect(await loopbackClient(fixture).resolve(refused)).toEqual({ kind: 'unavailable', warnings: ['brouter-route-rejected'] });
			expect(await loopbackClient(fixture).resolve(refused)).toEqual({ kind: 'unavailable', warnings: ['brouter-route-rejected'] });
			expect(requests).toHaveLength(1);
		} finally { fixture.server.close(); }
	});
	it('uses an exact query/header allowlist and preserves returned geometry', async () => {
    const requests: { url: string; headers: Record<string, unknown> }[] = [];
    const fixture = await fixtureServer((_profile, request, response) => {
      requests.push({ url: request.url ?? '', headers: request.headers });
      response.writeHead(200, { 'content-type': 'application/geo+json' });
       const end = requests.length > 1 ? [5, 6] : [3, 4];
       const start = requests.length > 1 ? [3, 4] : [1, 2];
       response.end(JSON.stringify({ type: 'LineString', coordinates: [start, end] }));
	});

    try {
      const result = await new BrouterClient({ endpoint: fixture.endpoint, allowedOrigins: [fixture.origin], allowLoopbackForTests: true, lookup: async () => [{ address: '127.0.0.1', family: 4 }] }).resolve(parsed);
      expect(result).toEqual({ kind: 'resolved', route: { type: 'LineString', coordinates: [[1, 2], [3, 4], [5, 6]] }, warnings: [] });
      expect(requests).toHaveLength(2);
      expect(requests[0].url).toContain('lonlats=1,2|3,4&profile=trekking&alternativeidx=0&format=geojson');
      expect(requests[1].url).toContain('lonlats=3,4|5,6&profile=trekking&alternativeidx=0&format=geojson');
      expect(requests[0].headers).not.toHaveProperty('cookie');
      expect(requests[0].headers).not.toHaveProperty('authorization');
      expect(requests[0].headers).not.toHaveProperty('referer');
    } finally { fixture.server.close(); }
  });

	it('supports Node lookup callbacks that request all pinned addresses', async () => {
		const fixture = await fixtureServer((_profile, _request, response) => {
			response.writeHead(200, { 'content-type': 'application/geo+json' });
			response.end(JSON.stringify({ type: 'LineString', coordinates: [[1, 2], [3, 4]] }));
		});
		try {
			const result = await new BrouterClient({ endpoint: fixture.endpoint, allowedOrigins: [fixture.origin], allowLoopbackForTests: true, lookup: async () => [{ address: '127.0.0.1', family: 4 }] }).resolve(parsed);
			expect(result.kind).toBe('resolved');
		} finally { fixture.server.close(); }
	});

	it('caches normalized segments and supports an explicit cache bypass', async () => {
		const requests: string[] = [];
		const fixture = await fixtureServer((_profile, request, response) => {
			requests.push(request.url ?? '');
			response.writeHead(200, { 'content-type': 'application/geo+json' });
			response.end(JSON.stringify({ type: 'LineString', coordinates: [[7, 8], [9, 10]] }));
		});
		const previous = process.env.BROUTER_CACHE_ENABLED;
		delete process.env.BROUTER_CACHE_ENABLED;
		try {
			const client = () => new BrouterClient({ endpoint: fixture.endpoint, allowedOrigins: [fixture.origin], allowLoopbackForTests: true, lookup: async () => [{ address: '127.0.0.1', family: 4 }] }).resolve(twoPointParsed);
			await client();
			await client();
			expect(requests).toHaveLength(1);
			process.env.BROUTER_CACHE_ENABLED = 'false';
			await client();
			expect(requests).toHaveLength(2);
		} finally {
			if (previous === undefined) delete process.env.BROUTER_CACHE_ENABLED;
			else process.env.BROUTER_CACHE_ENABLED = previous;
			fixture.server.close();
		}
	});

	// Real-backend UAT (2026-10-12): resolve() had no overall time budget, so a slow route held
	// the whole page up. The budget bounds how long the PAGE waits -- it must not also throw away
	// the work: a route that needs longer than one page load is willing to wait would otherwise
	// time out identically for every visitor, forever. The page gets "no route yet" on time, the
	// resolution carries on, and the next load has it.
	it('answers within the page\'s time budget while a slow route finishes in the background for the next load', async () => {
		const many = parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=1,2;3,4;5,6;7,8;9,10&profile=trekking');
		if (many.kind !== 'resolved') throw new Error('fixture permalink did not parse');
		const requests: string[] = [];
		const fixture = await fixtureServer((_profile, request, response) => {
			requests.push(request.url ?? '');
			setTimeout(() => {
				response.writeHead(200, { 'content-type': 'application/geo+json' });
				response.end(legResponse(request.url, 2));
			}, 200);
		});
		const previousBudget = process.env.BROUTER_MAX_TOTAL_MS;
		process.env.BROUTER_MAX_TOTAL_MS = '50';
		try {
			const started = Date.now();
			const result = await loopbackClient(fixture).resolve(many);
			expect(result).toEqual({ kind: 'unavailable', warnings: ['brouter-timeout'] });
			expect(Date.now() - started).toBeLessThan(180);
			// A second visitor arriving meanwhile joins the same work rather than starting it again.
			expect(await loopbackClient(fixture).resolve(many)).toEqual({ kind: 'unavailable', warnings: ['brouter-timeout'] });
			await new Promise((resolve) => setTimeout(resolve, 400));
			expect(await loopbackClient(fixture).resolve(many)).toMatchObject({ kind: 'resolved', route: { type: 'LineString', coordinates: [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]] } });
			expect(requests).toHaveLength(4);
		} finally {
			if (previousBudget === undefined) delete process.env.BROUTER_MAX_TOTAL_MS;
			else process.env.BROUTER_MAX_TOTAL_MS = previousBudget;
			fixture.server.close();
		}
	});

	it('resolves the supplied BRouter-Web permalink as adjacent segments', async () => {
		const value = parseBrouterWebPermalink('https://brouter.de/brouter-web/?utm_source=chatgpt.com#map=18/37.74353/-105.50588/standard&lonlats=-105.273743,40.014994;-105.24031,39.910964;-105.089607,39.553118;-104.990787,39.475724;-105.505185,37.744602;-105.747645,38.021343;-105.258356,39.997946&profile=car-fast');
		if (value.kind !== 'resolved') throw new Error('supplied permalink did not parse');
		const requests: string[] = [];
		const fixture = await fixtureServer((_profile, request, response) => {
			requests.push(request.url ?? '');
			response.writeHead(200, { 'content-type': 'application/geo+json' });
			response.end(JSON.stringify({ type: 'LineString', coordinates: [[1, 2], [3, 4]] }));
		});
		try {
			const result = await new BrouterClient({ endpoint: fixture.endpoint, allowedOrigins: [fixture.origin], allowLoopbackForTests: true, lookup: async () => [{ address: '127.0.0.1', family: 4 }] }).resolve(value);
			expect(result).toMatchObject({ kind: 'resolved', route: { type: 'LineString' } });
			expect(requests).toHaveLength(6);
			// Legs go out a few at a time, so arrival order is not the route's order.
			expect(requests.some((url) => url.includes('lonlats=-105.273743,40.014994|-105.24031,39.910964'))).toBe(true);
			expect(requests.some((url) => url.includes('lonlats=-105.747645,38.021343|-105.258356,39.997946'))).toBe(true);
		} finally { fixture.server.close(); }
	});

	it.skipIf(!process.env.RUN_LIVE_BROUTER_TESTS)('resolves the supplied permalink through public BRouter', async () => {
		const value = parseBrouterWebPermalink('https://brouter.de/brouter-web/?utm_source=chatgpt.com#map=18/37.74353/-105.50588/standard&lonlats=-105.273743,40.014994;-105.24031,39.910964;-105.089607,39.553118;-104.990787,39.475724;-105.505185,37.744602;-105.747645,38.021343;-105.258356,39.997946&profile=car-fast');
		if (value.kind !== 'resolved') throw new Error('supplied permalink did not parse');
		const result = await new BrouterClient({ endpoint: 'https://brouter.de/brouter', allowedOrigins: ['https://brouter.de'] }).resolve(value);
		expect(result).toMatchObject({ kind: 'resolved' });
	});

  it('returns typed non-fatal outcomes for malformed, status, redirect, and oversized responses', async () => {
    const fixture = await fixtureServer((profile, _request, response) => {
      if (profile === 'trekking') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('not geojson'); return; }
      if (profile === 'fastbike') { response.writeHead(200, { 'content-type': 'application/geo+json' }); response.end('{'); return; }
      if (profile === 'car-fast') { response.writeHead(400); response.end(); return; }
      if (profile === 'safety') { response.writeHead(429); response.end(); return; }
      if (profile === 'shortest') { response.writeHead(302, { location: '/elsewhere' }); response.end(); return; }
      response.writeHead(200, { 'content-type': 'application/geo+json' }); response.end('x'.repeat(DEFAULT_BROUTER_MAX_RESPONSE_BYTES + 1));
    });
    try {
      for (const [profile, warning] of [['trekking', 'brouter-response-invalid'], ['fastbike', 'brouter-response-invalid'], ['car-fast', 'brouter-route-rejected'], ['safety', 'brouter-request-failed'], ['shortest', 'brouter-request-failed'], ['car-eco', 'brouter-response-too-large']] as const) {
        const value = parseBrouterWebPermalink(`https://brouter.de/brouter-web/#lonlats=1,2%7C3,4&profile=${profile}`);
        if (value.kind !== 'resolved') throw new Error('fixture profile did not parse');
        const result = await new BrouterClient({ endpoint: fixture.endpoint, allowedOrigins: [fixture.origin], allowLoopbackForTests: true, lookup: async () => [{ address: '127.0.0.1', family: 4 }] }).resolve(value);
        expect(result).toEqual({ kind: 'unavailable', warnings: [warning] });
      }
    } finally { fixture.server.close(); }
  });

  it('keeps explicit local sources network-free and gives explicit sources precedence over markers', async () => {
    const context = { markers: [{ id: 'asset', lat: 10, lon: 20 }], assets: [] };
    expect(resolveWaypoints([[20, 10], [20, 10], [21, 11]])).toMatchObject({ kind: 'resolved', route: { coordinates: [[20, 10], [20, 10], [21, 11]] } });
    const registry = new PathSourceRegistry();
    expect(registry.resolve({ source: 'geojson', geojson: JSON.stringify({ type: 'LineString', coordinates: [[30, 12], [31, 13]] }) }, context)).toMatchObject({ kind: 'resolved', route: { coordinates: [[30, 12], [31, 13]] } });
    expect(registry.resolve({ source: 'waypoints', waypoints: [[40, 14], [41, 15]] }, context)).toMatchObject({ kind: 'resolved', route: { coordinates: [[40, 14], [41, 15]] } });
  });
});

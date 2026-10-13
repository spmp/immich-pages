import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { BrouterClient, parseBrouterMaxResponseBytes } from '../../src/lib/server/map/brouter-client';
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

describe('BRouter route adapter boundary', () => {
	it('bounds the configurable response limit', () => {
		expect(parseBrouterMaxResponseBytes(undefined)).toBe(256 * 1024);
		expect(parseBrouterMaxResponseBytes('1048576')).toBe(1048576);
		expect(parseBrouterMaxResponseBytes('65535')).toBe(256 * 1024);
		expect(parseBrouterMaxResponseBytes('9000000')).toBe(256 * 1024);
		expect(parseBrouterMaxResponseBytes('not-a-number')).toBe(256 * 1024);
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

	// Real-backend UAT (2026-10-12): resolve() had no OVERALL time budget -- only a per-segment
	// timeout. A route with many waypoints (now also capped in brouter-web.ts, but the aggregate
	// budget is the real backstop) could take minutes of real page-assembly time with nothing
	// bounding the total, reported as "the map does not show".
	it('stops attempting further segments once the aggregate time budget is spent', async () => {
		const many = parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=1,2;3,4;5,6;7,8;9,10&profile=trekking');
		if (many.kind !== 'resolved') throw new Error('fixture permalink did not parse');
		const requests: string[] = [];
		const fixture = await fixtureServer((_profile, request, response) => {
			requests.push(request.url ?? '');
			setTimeout(() => {
				response.writeHead(200, { 'content-type': 'application/geo+json' });
				response.end(JSON.stringify({ type: 'LineString', coordinates: [[1, 2], [3, 4]] }));
			}, 30);
		});
		const previousBudget = process.env.BROUTER_MAX_TOTAL_MS;
		process.env.BROUTER_MAX_TOTAL_MS = '50';
		try {
			const result = await new BrouterClient({ endpoint: fixture.endpoint, allowedOrigins: [fixture.origin], allowLoopbackForTests: true, lookup: async () => [{ address: '127.0.0.1', family: 4 }] }).resolve(many);
			expect(result).toEqual({ kind: 'unavailable', warnings: ['brouter-timeout'] });
			// 4 segments at 30ms each (120ms) against a 50ms budget: the deadline check before
			// starting each new segment must stop it well short of attempting all 4.
			expect(requests.length).toBeLessThan(4);
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
			expect(requests[0]).toContain('lonlats=-105.273743,40.014994|-105.24031,39.910964');
			expect(requests[5]).toContain('lonlats=-105.747645,38.021343|-105.258356,39.997946');
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
      response.writeHead(200, { 'content-type': 'application/geo+json' }); response.end('x'.repeat(300_000));
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

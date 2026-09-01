import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { BrouterClient } from '../../src/lib/server/map/brouter-client';
import { parseBrouterWebPermalink } from '../../src/lib/server/map/brouter-web';
import { PathSourceRegistry, resolveWaypoints } from '../../src/lib/server/map/path-adapters';

const parsed = parseBrouterWebPermalink('https://brouter.de/brouter-web/#lonlats=1,2%7C3,4&profile=trekking');
if (parsed.kind !== 'resolved') throw new Error('fixture permalink did not parse');

async function fixtureServer(handler: (profile: string | null, request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void) {
  const server = createServer((request, response) => handler(new URL(request.url ?? '/', 'http://fixture').searchParams.get('profile'), request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not start');
  return { server, endpoint: `http://127.0.0.1:${address.port}/brouter`, origin: `http://127.0.0.1:${address.port}` };
}

describe('BRouter route adapter boundary', () => {
  it('uses an exact query/header allowlist and preserves returned geometry', async () => {
    const requests: { url: string; headers: Record<string, unknown> }[] = [];
    const fixture = await fixtureServer((_profile, request, response) => {
      requests.push({ url: request.url ?? '', headers: request.headers });
      response.writeHead(200, { 'content-type': 'application/geo+json' });
      response.end(JSON.stringify({ type: 'LineString', coordinates: [[1, 2], [3, 4]] }));
    });
    try {
      const result = await new BrouterClient({ endpoint: fixture.endpoint, allowedOrigins: [fixture.origin], allowLoopbackForTests: true, lookup: async () => [{ address: '127.0.0.1', family: 4 }] }).resolve(parsed);
      expect(result).toEqual({ kind: 'resolved', route: { type: 'LineString', coordinates: [[1, 2], [3, 4]] }, warnings: [] });
      expect(new URL(requests[0].url, fixture.origin).searchParams.toString()).toBe('lonlats=1%2C2%7C3%2C4&profile=trekking&alternativeidx=0&format=geojson');
      expect(requests[0].headers).not.toHaveProperty('cookie');
      expect(requests[0].headers).not.toHaveProperty('authorization');
    } finally { fixture.server.close(); }
  });

  it('returns typed non-fatal outcomes for malformed, status, redirect, and oversized responses', async () => {
    const fixture = await fixtureServer((profile, _request, response) => {
      if (profile === 'trekking') { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('not geojson'); return; }
      if (profile === 'fastbike') { response.writeHead(200, { 'content-type': 'application/geo+json' }); response.end('{'); return; }
      if (profile === 'safety') { response.writeHead(429); response.end(); return; }
      if (profile === 'shortest') { response.writeHead(302, { location: '/elsewhere' }); response.end(); return; }
      response.writeHead(200, { 'content-type': 'application/geo+json' }); response.end('x'.repeat(300_000));
    });
    try {
      for (const [profile, warning] of [['trekking', 'brouter-response-invalid'], ['fastbike', 'brouter-response-invalid'], ['safety', 'brouter-request-failed'], ['shortest', 'brouter-request-failed'], ['car-eco', 'brouter-response-too-large']] as const) {
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

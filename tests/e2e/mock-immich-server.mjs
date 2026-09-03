import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const videoFixture = readFileSync(fileURLToPath(new URL('../fixtures/video/chromium-2s-320x180-h264-aac.mp4', import.meta.url)));
const landscapeFixture = readFileSync(fileURLToPath(new URL('../fixtures/images/landscape-1200x800.png', import.meta.url)));
const portraitFixture = readFileSync(fileURLToPath(new URL('../fixtures/images/portrait-800x1200.png', import.meta.url)));

const assets = [{
  id: '550e8400-e29b-41d4-a716-446655440002', type: 'IMAGE', originalFileName: 'mock-proof.jpg', width: 1200, height: 800
}, {
  id: '550e8400-e29b-41d4-a716-446655440005', type: 'VIDEO', originalFileName: 'mock-clip.mp4', width: 640, height: 360, duration: 1000
}, {
  id: '550e8400-e29b-41d4-a716-446655440007', type: 'IMAGE', originalFileName: 'portrait-proof.jpg', width: 800, height: 1200
}, {
  id: '550e8400-e29b-41d4-a716-446655440006', type: 'IMAGE', originalFileName: 'failing-photo.jpg', width: 800, height: 1200
}];

const libraryAssets = [{
  id: '550e8400-e29b-41d4-a716-446655440008', type: 'IMAGE', originalFileName: 'alpine-proof.jpg', width: 1200, height: 800
}];
const libraryAlbums = [{
  id: '550e8400-e29b-41d4-a716-446655440003', albumName: 'Mock Journey', albumThumbnailAssetId: libraryAssets[0].id,
  startDate: '2026-03-02T00:00:00.000Z', endDate: '2026-03-04T00:00:00.000Z', updatedAt: '2026-03-04T00:00:00.000Z',
  description: '---\nimmich-presentation:\n  type: journey\n  version: 1\n---\nAuthenticated journey one'
}, {
  id: '550e8400-e29b-41d4-a716-446655440009', albumName: 'Older Journey', albumThumbnailAssetId: null,
  startDate: '2025-10-01T00:00:00.000Z', endDate: '2025-10-02T00:00:00.000Z', updatedAt: '2025-10-02T00:00:00.000Z',
  description: '---\nimmich-presentation:\n  type: journey\n  version: 1\n---\nAuthenticated journey two'
}, {
  id: '550e8400-e29b-41d4-a716-446655440010', albumName: 'Private Family Album', description: 'Ordinary album'
}];
let revokedLibraryAlbums = new Set();
let revokedShareRefs = new Set();
let expiredShareRefs = new Set();
const requestCounts = new Map();
let shareLoginAttempts = 0;

function count(pathname) { requestCounts.set(pathname, (requestCounts.get(pathname) ?? 0) + 1); }

function isUserSession(request) {
  return request.headers.cookie === 'immich_user=fixture' && ['Bearer fixture-user', 'Bearer fixture-revoked'].includes(request.headers.authorization);
}

function isRevokedSession(request) { return request.headers.authorization === 'Bearer fixture-revoked'; }

const page = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  description: null,
  password: null,
  userId: '550e8400-e29b-41d4-a716-446655440001',
  key: 'opaque-ref',
  type: 'ALBUM',
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
  allowUpload: false,
  slug: null,
  album: {
    id: '550e8400-e29b-41d4-a716-446655440003',
    albumName: 'Mock Journey',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-01-01T00:00:00.000Z',
    description: '---\nimmich-presentation:\n  type: journey\n  version: 1\n---\nMock browser proof'
  },
  assets,
  showMetadata: true,
   allowDownload: false
};

function shareForRef(ref) {
  if (ref === 'second-ref') return { ...page, slug: ref, album: { ...page.album, albumName: 'Second Journey', description: '---\nimmich-presentation:\n  type: journey\n  version: 1\n---\nMock browser proof two' } };
  return page;
}

const mapMarkers = [
  { id: assets[0].id, lat: 51.5074, lon: -0.1278, city: 'London', state: null, country: 'United Kingdom' },
  { id: assets[2].id, lat: 48.8566, lon: 2.3522, city: 'Paris', state: null, country: 'France' }
];

const routeDescriptions = {
  'route-waypoints': `---\nimmich-presentation:\n  type: journey\n  version: 1\n  map:\n    enabled: true\n    source: waypoints\n    waypoints:\n      - [-0.1278, 51.5074]\n      - [-0.1278, 51.5074]\n      - [2.3522, 48.8566]\n    styleName: quiet-atlas\n---\nWaypoint route proof`,
  'route-geojson': `---\nimmich-presentation:\n  type: journey\n  version: 1\n  map:\n    enabled: true\n    source: geojson\n    geojson: |\n      {"type":"MultiLineString","coordinates":[[[-0.1278,51.5074],[-1.2577,51.7520]],[[2.3522,48.8566],[2.1734,41.3851]]]}\n    styleName: quiet-atlas\n---\nExact GeoJSON route proof`,
  'route-brouter': `---\nimmich-presentation:\n  type: journey\n  version: 1\n  map:\n    enabled: true\n    source: brouter-web\n    url: https://brouter.de/brouter-web/#lonlats=-0.1278,51.5074%7C2.3522,48.8566&profile=trekking\n    styleName: quiet-atlas\n---\nBRouter success proof`,
  'route-brouter-live': `---\nimmich-presentation:\n  type: journey\n  version: 1\n  map:\n    enabled: true\n    source: brouter-web\n    url: "https://brouter.de/brouter-web/?utm_source=chatgpt.com#map=18/37.74353/-105.50588/standard&lonlats=-105.273743,40.014994;-105.24031,39.910964;-105.089607,39.553118;-104.990787,39.475724;-105.505185,37.744602;-105.747645,38.021343;-105.258356,39.997946&profile=car-fast"\n    styleName: quiet-atlas\n---\nBRouter live permalink proof`,
  'route-brouter-failure': `---\nimmich-presentation:\n  type: journey\n  version: 1\n  map:\n    enabled: true\n    source: brouter-web\n    url: https://brouter.de/brouter-web/#lonlats=-0.1278,51.5074%7C2.3522,48.8566&profile=safety\n    styleName: quiet-atlas\n---\nBRouter failure proof`,
  'route-brouter-unsupported': `---\nimmich-presentation:\n  type: journey\n  version: 1\n  map:\n    enabled: true\n    source: brouter-web\n    url: https://brouter.de/brouter-web/#lonlats=-0.1278,51.5074%7C2.3522,48.8566&profile=unknown\n    styleName: quiet-atlas\n---\nUnsupported route proof`
};

const brouterRoutes = {
  trekking: { type: 'LineString', coordinates: [[-0.1278, 51.5074], [0.9, 50.9], [2.3522, 48.8566]] }
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://mock-immich.test');
  count(url.pathname);
  if (url.pathname === '/api/users/me' && isUserSession(request)) {
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', name: 'Fixture User' })); return;
  }
  if (url.pathname === '/api/users/me') { response.writeHead(401); response.end(); return; }
  if (url.pathname === '/api/albums' && isUserSession(request)) {
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(libraryAlbums)); return;
  }
  if (url.pathname === '/api/albums') { response.writeHead(401); response.end(); return; }
  const libraryAlbum = libraryAlbums.find((candidate) => url.pathname === `/api/albums/${candidate.id}`);
  if (libraryAlbum) {
    if (!isUserSession(request) || isRevokedSession(request) && libraryAlbum.id === libraryAlbums[0].id || revokedLibraryAlbums.has(libraryAlbum.id)) { response.writeHead(isUserSession(request) ? 403 : 401); response.end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ...libraryAlbum, assetCount: libraryAlbum.id === libraryAlbums[0].id ? libraryAssets.length : 0 })); return;
  }
  if (request.method === 'POST' && url.pathname === '/api/search/metadata' && isUserSession(request)) {
    let body = ''; request.on('data', (chunk) => { body += chunk; }); request.on('end', () => {
      const albumId = JSON.parse(body).albumIds?.[0];
      if (isRevokedSession(request) && albumId === libraryAlbums[0].id || revokedLibraryAlbums.has(albumId)) { response.writeHead(403); response.end(); return; }
      const found = albumId === libraryAlbums[0].id ? libraryAssets : [];
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ albums: {}, assets: { items: found } }));
    }); return;
  }
  const libraryAsset = url.pathname.match(/^\/api\/assets\/([^/]+)\/thumbnail$/)?.[1];
  if (libraryAsset && isUserSession(request) && libraryAssets.some((asset) => asset.id === libraryAsset)) {
    if (isRevokedSession(request) || revokedLibraryAlbums.has(libraryAlbums[0].id)) { response.writeHead(403); response.end(); return; }
    response.writeHead(200, { 'content-type': 'image/png', 'set-cookie': 'secret=must-not-relay; Path=/' }); response.end(landscapeFixture); return;
  }
  if (url.pathname === '/api/server/version') {
    response.writeHead(200, { 'content-type': 'application/json' });
     response.end(JSON.stringify({ version: 'v3.1.0' }));
    return;
  }
  if (url.pathname === '/__fixture/revoke' && request.method === 'POST') {
    const albumId = url.searchParams.get('album'); if (albumId) revokedLibraryAlbums.add(albumId);
    const ref = url.searchParams.get('ref'); if (ref) revokedShareRefs.add(ref);
    response.writeHead(204); response.end(); return;
  }
  if (url.pathname === '/__fixture/expire' && request.method === 'POST') {
    const ref = url.searchParams.get('ref'); if (ref) expiredShareRefs.add(ref);
    response.writeHead(204); response.end(); return;
  }
  if (url.pathname === '/__fixture/observations' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(Object.fromEntries(requestCounts))); return;
  }
  if (url.pathname === '/__fixture/reset' && request.method === 'POST') {
    revokedLibraryAlbums.clear(); revokedShareRefs.clear(); expiredShareRefs.clear(); requestCounts.clear(); response.writeHead(204); response.end(); return;
  }

  if (url.pathname === '/api/shared-links/me' && (url.searchParams.has('key') || url.searchParams.has('slug'))) {
    const ref = url.searchParams.get('key') ?? url.searchParams.get('slug');
    const shareRef = url.searchParams.get('key') ?? url.searchParams.get('slug');
    if (!['opaque-ref', 'second-ref', 'password-share', 'unauthorized', 'error'].includes(shareRef)) { response.writeHead(403); response.end(); return; }
    if (revokedShareRefs.has(ref) || expiredShareRefs.has(ref)) { response.writeHead(403); response.end(); return; }
    if (ref === 'password-share' && request.headers.cookie !== 'immich_shared_link_token=fixture') {
      response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'secret=must-not-relay; Path=/' });
      response.end(JSON.stringify({ ...page, password: 'required' }));
      return;
    }
    if (ref === 'unauthorized') {
      response.writeHead(403, { 'content-type': 'application/json', 'set-cookie': 'secret=must-not-relay; Path=/' });
      response.end(JSON.stringify({ error: 'not authorized' }));
      return;
    }
    if (ref === 'error') {
      response.writeHead(503, { 'content-type': 'application/json', 'set-cookie': 'secret=must-not-relay; Path=/' });
      response.end(JSON.stringify({ error: 'temporary failure' }));
      return;
    }
    const body = routeDescriptions[ref]
      ? { ...shareForRef(ref), album: { ...shareForRef(ref).album, description: routeDescriptions[ref] } }
      : ref === 'non-page'
      ? { ...page, album: { ...page.album, description: 'An ordinary album' } }
         : ref === 'map-ref'
         ? { ...page, assets: assets.map((asset, index) => index === 0 ? { ...asset, localDateTime: '2026-01-01T00:00:00.000Z' } : index === 2 ? { ...asset, localDateTime: '2026-01-02T00:00:00.000Z' } : asset), album: { ...page.album, description: '---\nimmich-presentation:\n  type: journey\n  version: 1\n  map:\n    enabled: true\n    source: auto\n    showMarkerList: true\n    styleName: quiet-atlas\n---\nMap browser proof' } }
         : shareForRef(ref);
    response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'secret=must-not-relay; Path=/' });
    response.end(JSON.stringify({ ...body, album: { ...body.album, assetCount: assets.length } }));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/shared-links/login' && (url.searchParams.has('key') || url.searchParams.has('slug'))) {
    shareLoginAttempts += 1;
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const password = JSON.parse(body).password;
      if (password !== 'fixture-password') { response.writeHead(401); response.end(); return; }
      response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'immich_shared_link_token=fixture; Path=/' });
      response.end(JSON.stringify({ ...page, password: null, token: 'fixture' }));
    });
    return;
  }

  if (url.pathname === '/brouter') {
    const profile = url.searchParams.get('profile');
    if (profile === 'trekking') {
      response.writeHead(200, { 'content-type': 'application/geo+json' });
      response.end(JSON.stringify(brouterRoutes.trekking));
      return;
    }
    if (profile === 'fastbike') { response.writeHead(200, { 'content-type': 'application/geo+json' }); response.end('{malformed'); return; }
    if (profile === 'safety') { response.writeHead(429, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture failure' })); return; }
    if (profile === 'shortest') { response.writeHead(503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'fixture failure' })); return; }
    if (profile === 'car-fast') { setTimeout(() => response.end(), 9_000); return; }
    if (profile === 'car-eco') { response.writeHead(200, { 'content-type': 'application/geo+json' }); response.end('x'.repeat(300_000)); return; }
    response.writeHead(302, { location: '/brouter' }); response.end();
    return;
  }

  if (url.pathname === `/api/albums/${page.album.id}/map-markers` && (url.searchParams.has('key') || url.searchParams.has('slug'))) {
    if (request.headers.cookie !== 'immich_shared_link_token=fixture' || request.headers.authorization !== 'Bearer fixture') {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'map request context rejected' }));
      return;
    }
    if (!['opaque-ref', 'map-ref', 'route-waypoints', 'route-geojson', 'route-brouter', 'route-brouter-live', 'route-brouter-failure', 'route-brouter-unsupported'].includes(url.searchParams.get('key') ?? url.searchParams.get('slug'))) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'map share mismatch' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(mapMarkers));
    return;
  }

  if (url.pathname === '/api/map-style.json') {
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': 'http://127.0.0.1:4173', 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'authorization, content-type' }); response.end(); return; }
    response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': 'http://127.0.0.1:4173' });
    response.end(readFileSync(fileURLToPath(new URL('../fixtures/map/style.json', import.meta.url))));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/search/metadata' && (url.searchParams.has('key') || url.searchParams.has('slug'))) {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ albums: {}, assets: { items: assets } }));
    });
    return;
  }

  if ((url.pathname === '/api/assets/550e8400-e29b-41d4-a716-446655440002/thumbnail' || url.pathname === '/api/assets/550e8400-e29b-41d4-a716-446655440007/thumbnail') && (url.searchParams.get('key') === 'opaque-ref' || url.searchParams.get('slug') === 'opaque-ref')) {
    if (request.headers.cookie !== 'immich_shared_link_token=fixture' || request.headers.authorization !== 'Bearer fixture') {
      response.writeHead(403, { 'content-type': 'application/json', 'set-cookie': 'secret=must-not-relay; Path=/' });
      response.end(JSON.stringify({ error: 'thumbnail request context rejected' }));
      return;
    }
    const fixture = url.pathname.includes('550e8400-e29b-41d4-a716-446655440007') ? portraitFixture : landscapeFixture;
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': fixture.length });
    response.end(fixture);
    return;
  }

  if (url.pathname === '/api/assets/550e8400-e29b-41d4-a716-446655440005/video/playback' && (url.searchParams.get('key') === 'opaque-ref' || url.searchParams.get('slug') === 'opaque-ref')) {
    if (request.headers.cookie !== 'immich_shared_link_token=fixture' || request.headers.authorization !== 'Bearer fixture') { response.writeHead(403); response.end(); return; }
    const range = request.headers.range;
    if (!range) {
      response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': videoFixture.length, 'accept-ranges': 'bytes' });
      response.end(videoFixture);
      return;
    }
    const match = range.match(/^bytes=(\d+)-(\d*)$/);
    if (!match) { response.writeHead(416, { 'content-range': `bytes */${videoFixture.length}` }); response.end(); return; }
    const start = Number(match[1]);
    const requestedEnd = match[2] === '' ? videoFixture.length - 1 : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start > requestedEnd || start >= videoFixture.length) {
      response.writeHead(416, { 'content-range': `bytes */${videoFixture.length}` }); response.end(); return;
    }
    const end = Math.min(requestedEnd, videoFixture.length - 1);
    const data = videoFixture.subarray(start, end + 1);
    response.writeHead(206, { 'content-type': 'video/mp4', 'content-length': data.length, 'content-range': `bytes ${start}-${end}/${videoFixture.length}`, 'accept-ranges': 'bytes' });
    response.end(data);
    return;
  }

  if (url.pathname === '/api/assets/550e8400-e29b-41d4-a716-446655440006/thumbnail') {
    response.writeHead(404, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'individual media failure' })); return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
});

server.listen(Number(process.env.MOCK_IMMICH_PORT ?? 0), '127.0.0.1', () => {
  const address = server.address();
  if (typeof address === 'object' && address) console.log(`MOCK_IMMICH_READY ${address.port}`);
});

function close() {
  server.close(() => process.exit(0));
}
process.once('SIGTERM', close);
process.once('SIGINT', close);

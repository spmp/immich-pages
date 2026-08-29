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

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://mock-immich.test');
  if (url.pathname === '/api/server/version') {
    response.writeHead(200, { 'content-type': 'application/json' });
     response.end(JSON.stringify({ version: 'v3.1.0' }));
    return;
  }

  if (url.pathname === '/api/shared-links/me' && (url.searchParams.has('key') || url.searchParams.has('slug'))) {
    const ref = url.searchParams.get('key') ?? url.searchParams.get('slug');
    if (request.headers.cookie !== 'immich_shared_link_token=fixture' || request.headers.authorization !== 'Bearer fixture') {
      response.writeHead(403, { 'content-type': 'application/json', 'set-cookie': 'secret=must-not-relay; Path=/' });
      response.end(JSON.stringify({ error: 'request context rejected' }));
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
    const body = ref === 'non-page'
      ? { ...page, album: { ...page.album, description: 'An ordinary album' } }
      : page;
    response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'secret=must-not-relay; Path=/' });
    response.end(JSON.stringify({ ...body, album: { ...body.album, assetCount: assets.length } }));
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

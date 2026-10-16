import http from 'node:http';

const assetId = '550e8400-e29b-41d4-a716-446655440002';
const videoId = '550e8400-e29b-41d4-a716-446655440004';
const albumId = '550e8400-e29b-41d4-a716-446655440003';
const observations = [];
const revoked = new Set();

const asset = { id: assetId, type: 'IMAGE', originalFileName: 'proxy-proof.jpg', originalMimeType: 'image/jpeg', width: 640, height: 480 };
const video = { id: videoId, type: 'VIDEO', originalFileName: 'proxy-proof.mp4', originalMimeType: 'video/mp4', duration: 4 };
const page = (key, password = null, flags = {}) => ({
  id: '550e8400-e29b-41d4-a716-446655440001', description: 'fixture', password,
  userId: '550e8400-e29b-41d4-a716-446655440000', key, type: 'ALBUM', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: flags.expired ? '2020-01-01T00:00:00.000Z' : null,
  album: { id: albumId, albumName: 'Traefik Journey', description: '---\nimmich-presentation:\n  type: journey\n  version: 1\n---\nProxy proof', assetCount: 2 },
  assets: [asset, video], allowUpload: false, allowDownload: flags.allowDownload ?? false, showMetadata: flags.showMetadata ?? true, slug: key
});

const shares = new Map([
  ['opaque-ref', page('opaque-ref', 'fixture-password')],
  ['non-page', { ...page('non-page'), album: { ...page('non-page').album, description: 'An ordinary album' }, assets: [asset] }],
  ['expired', page('expired', null, { expired: true })],
  ['revoked', page('revoked')],
  ['map-ref', page('map-ref')]
]);

function observe(request, operation) {
  observations.push({ operation, host: request.headers['x-forwarded-host'] ?? null, protocol: request.headers['x-forwarded-proto'] ?? null, cookie: request.headers.cookie ?? null, authorization: request.headers.authorization ?? null, synthesizedOwnerCredential: Boolean(request.headers['x-api-key'] || request.headers['x-owner-token']) });
}
function json(res, status, body, headers = {}) { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); }
function refFromUrl(url) { return new URL(`http://fixture${url}`).searchParams.get('key') ?? new URL(`http://fixture${url}`).searchParams.get('slug'); }
function authorized(request) { return request.headers.cookie === 'immich_shared_link_token=fixture'; }
function expired(share) { return Boolean(share?.expiresAt && Date.parse(share.expiresAt) <= Date.now()); }

const server = http.createServer(async (request, res) => {
  const url = request.url ?? '/';
  if (url === '/api/server/version') return json(res, 200, { major: 3, minor: 1, patch: 0 });
  if (url === '/__fixture__/observations') return json(res, 200, observations);
  if (url.startsWith('/api/shared-links/login?')) {
    const key = refFromUrl(url); observe(request, 'login');
    let body = ''; for await (const chunk of request) body += chunk;
    if (key !== 'opaque-ref' || JSON.parse(body || '{}').password !== 'fixture-password') return json(res, 401, { error: 'invalid credentials' }, { 'set-cookie': 'immich_shared_link_token=upstream-secret; Path=/' });
    return json(res, 200, shares.get(key), { 'set-cookie': 'immich_shared_link_token=fixture; Path=/; HttpOnly' });
  }
  if (url.startsWith('/api/shared-links/me?')) {
    const key = refFromUrl(url); observe(request, 'page');
    if (!key || !shares.has(key) || revoked.has(key)) return json(res, 404, { error: 'not found' }, { 'set-cookie': 'immich_shared_link_token=upstream-secret; Path=/' });
    const share = shares.get(key);
    if (expired(share)) return json(res, 403, { error: 'expired' });
    if (!authorized(request)) return json(res, 200, { ...share, password: share.password ?? null });
    return json(res, 200, { ...share, password: null }, { 'set-cookie': 'immich_shared_link_token=upstream-secret; Path=/' });
  }
  const media = url.match(/^\/api\/assets\/([^/]+)\/(thumbnail|original|video\/playback)/);
  if (media) {
    const key = refFromUrl(url); observe(request, media[2] === 'thumbnail' ? 'thumbnail' : 'video');
    if (!key || !shares.has(key) || revoked.has(key) || expired(shares.get(key)) || !authorized(request, key)) return json(res, 403, { error: 'forbidden' });
    if (media[2] === 'thumbnail' || media[2] === 'original') { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store' }); return res.end('fixture-image'); }
    const body = Buffer.from('fixture-video-range'); const range = request.headers.range;
    const headers = { 'content-type': 'video/mp4', 'cache-control': 'private, no-store', 'accept-ranges': 'bytes' };
    if (range) { const match = /^bytes=(\d+)-(\d*)$/.exec(range); if (!match) return res.writeHead(416).end(); const start = Number(match[1]); const end = Math.min(match[2] ? Number(match[2]) : body.length - 1, body.length - 1); headers['content-range'] = `bytes ${start}-${end}/${body.length}`; res.writeHead(206, headers); return res.end(body.subarray(start, end + 1)); }
    res.writeHead(200, headers); return res.end(body);
  }
  if (url === '/albums' || url.startsWith('/api/albums/')) return json(res, 200, 'ordinary Immich path');
  json(res, 404, { error: 'ordinary Immich path' });
}).listen(3001, '0.0.0.0');

process.on('SIGTERM', () => server.close(() => process.exit(0)));

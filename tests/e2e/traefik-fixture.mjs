import http from 'node:http';

const response = {
  album: {
    id: 'album-1',
    albumName: 'Traefik Journey',
    description: '---\nimmich-presentation:\n  type: journey\n  version: 1\n---\nProxy proof'
  },
  assets: [
    {
      id: 'asset-1',
      thumbnailPath: '/api/assets/asset-1/thumbnail',
      viewPath: '/api/assets/asset-1/original',
      originalFileName: 'proxy-proof.jpg'
    }
  ],
  showMetadata: true,
  allowDownload: false
};

http.createServer((request, res) => {
  if (request.url === '/api/server/version') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ major: 1, minor: 143, patch: 1 }));
    return;
  }

  if (request.url?.startsWith('/api/shared-links/me?key=') || request.url?.startsWith('/api/shared-links/me?slug=')) {
    const expectedCookie = request.headers.cookie === 'immich_shared_link_token=fixture';
    const expectedAuthorization = request.headers.authorization === 'Bearer fixture';
    const forwardedHost = request.headers['x-forwarded-host'];
    const forwardedProto = request.headers['x-forwarded-proto'];
    if (!expectedCookie || !expectedAuthorization || forwardedHost !== 'pages.example.xyz' || forwardedProto !== 'http') {
      res.writeHead(403, { 'content-type': 'application/json', 'set-cookie': 'secret=must-not-relay; Path=/' });
      res.end(JSON.stringify({ error: 'fixture request context rejected' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'secret=must-not-relay; Path=/' });
    res.end(JSON.stringify(response));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}).listen(3001, '0.0.0.0');

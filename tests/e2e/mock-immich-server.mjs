import http from 'node:http';

const page = {
  album: {
    id: 'album-mock',
    albumName: 'Mock Journey',
    description: '---\nimmich-presentation:\n  type: journey\n  version: 1\n---\nMock browser proof'
  },
  assets: [{
    id: 'asset-mock',
    type: 'IMAGE',
    thumbnailPath: '/api/assets/asset-mock/thumbnail',
    viewPath: '/api/assets/asset-mock/original',
    originalFileName: 'mock-proof.jpg'
  }],
  showMetadata: true,
  allowDownload: false
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://mock-immich.test');
  if (url.pathname === '/api/server/version') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ version: 'v1.143.1' }));
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
    response.end(JSON.stringify(body));
    return;
  }

  if (url.pathname === '/api/assets/asset-mock/thumbnail') {
    response.writeHead(200, { 'content-type': 'image/svg+xml' });
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="teal"/></svg>');
    return;
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

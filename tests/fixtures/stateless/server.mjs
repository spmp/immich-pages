import http from 'node:http';

const page = {
  album: { id: 'stateless-album', albumName: 'Recreated Journey', description: '---\nimmich-presentation:\n  type: journey\n  version: 1\n---\nRecreated safely.' },
  assets: [{ id: 'stateless-asset', type: 'IMAGE', originalFileName: 'recreated.jpg', thumbnailPath: '/api/assets/stateless-asset/thumbnail', viewPath: '/api/assets/stateless-asset/original' }],
  showMetadata: true,
  allowDownload: false
};

http.createServer((request, response) => {
  if (request.url === '/api/server/version') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ major: 1, minor: 143, patch: 1 }));
    return;
  }
  if (request.url?.startsWith('/api/shared-links/me?key=') || request.url?.startsWith('/api/shared-links/me?slug=')) {
    response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'must-not-relay=secret' });
    response.end(JSON.stringify(page));
    return;
  }
  response.writeHead(404).end();
}).listen(3001, '0.0.0.0');

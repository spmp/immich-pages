import http from 'node:http';
import { readFileSync } from 'node:fs';

const page = JSON.parse(readFileSync(new URL('./shared-link-response.json', import.meta.url), 'utf8'));

http.createServer((request, response) => {
  if (request.url === '/api/server/version') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ major: 3, minor: 0, patch: 1 }));
    return;
  }
  if (request.url?.startsWith('/api/shared-links/me?key=') || request.url?.startsWith('/api/shared-links/me?slug=')) {
    response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'must-not-relay=secret' });
    response.end(JSON.stringify(page));
    return;
  }
  response.writeHead(404).end();
}).listen(3001, '0.0.0.0');

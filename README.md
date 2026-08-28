# Immich Pages

Immich Pages is a stateless, read-only SvelteKit presentation layer. Immich is
the sole CMS and source of truth for albums, descriptions, assets, metadata,
sharing, and authorization. Pages reconstructs a presentation from each
request; it has no database, media store, page index, or correctness-critical
volume. Deleting and recreating the container therefore does not delete pages.

## Phase 1 contract

The supported public grammar is exactly:

```text
https://pages.example.xyz/share/key/<opaque-ref>
https://pages.example.xyz/share/slug/<opaque-ref>
```

`key` and `slug` are explicit route kinds; Pages never guesses between them.
The reference is opaque, bounded, and request-scoped. Pages forwards only the
visitor's incoming `Cookie` and `Authorization` headers to the configured
`IMMICH_BASE_URL`. It never stores credentials, creates a Pages session, uses
an owner/API key fallback, or relays upstream `Set-Cookie` headers.

Phase 1 reads the authorized shared-link album and permitted embedded asset
descriptors. Browser media uses a narrow same-origin Pages thumbnail route that
re-authorizes each request against Immich. It does not implement password
login, full media/original/download proxying, maps, album discovery, mutations,
transparent Immich `/share` interception, or the full narrative parser. A
valid ordinary album share is a safe non-page result, not a rendered Page.

## Deployment

Copy `.env.example` to `.env`, set the trusted explicit `IMMICH_BASE_URL`, and
start the production service:

```sh
docker compose up -d --build
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/health/immich
```

`compose.yaml` contains one Pages service only: no database, media volume, or
required application storage. The image runs `node build` as the non-root
`node` user. Traefik must route `Host(`pages.example.xyz`)` over its secure
TLS entrypoint to Pages, while Pages calls the explicit origin
`IMMICH_BASE_URL=https://immich.example.xyz` and adds `/api` exactly once. See
[`docs/deployment.md`](docs/deployment.md) for headers, TLS, recovery, and
reverse-proxy operations.

## Development and testing

```sh
npm ci
npm run check
npm run test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e -- tests/e2e/direct-share.spec.ts
```

The browser test starts the disposable Pages/fake-Immich/Traefik topology,
uses the published `pages.example.xyz:18080` entrypoint, and tears it down
with volumes and orphans. It intentionally fails if Chromium is absent; it
does not silently switch browsers. TLS is checked separately against the
production Traefik deployment.

Svelte MCP and component tooling are development-only conveniences. Configure
the official Svelte MCP locally (for example with `npx -y @sveltejs/mcp`) and
do not add it to the runtime image or treat it as a user setup requirement.

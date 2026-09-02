# Immich Pages

Immich Pages is a stateless, read-only SvelteKit presentation layer. Immich is
the sole CMS and source of truth for albums, descriptions, assets, metadata,
sharing, and authorization. Pages reconstructs a presentation from each
request; it has no database, media store, page index, or correctness-critical
volume. Deleting and recreating the container therefore does not delete pages.
The current compatibility target is Immich v3.1.0.

## Share URL and proxy contract

The supported public grammar is exactly:

```text
https://pages.example.xyz/share/key/<opaque-ref>
https://pages.example.xyz/share/slug/<opaque-ref>
```

`key` and `slug` are explicit route kinds; Pages never guesses between them. The
same `/share/` paths may also be routed from `immich.example.xyz` to Pages by
Traefik. Viewers remain on Pages: upstream URLs, redirects, login pages, media
URLs, cookies, and response details are never relayed. Only the visitor's
incoming `Cookie` and `Authorization` reach the configured `IMMICH_BASE_URL`;
Pages never synthesizes an owner/API key credential.

Password handoff is delegated to Immich and stored only as a bounded,
host-scoped encrypted Pages session. Every page and media request revalidates
the share. A valid ordinary album share is a branded non-page result, not an
Immich redirect; ordinary Immich root paths remain outside the Pages router.

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
`node` user. Set `PAGES_SESSION_SECRET` (at least 32 random characters).
Traefik routes `Host(`pages.example.xyz`)` and only `Host(`immich.example.xyz`)
&& PathPrefix(`/share`)` to Pages over TLS; ordinary Immich paths are not
captured. Pages calls the explicit origin `IMMICH_BASE_URL=https://immich.example.xyz`
and adds `/api` exactly once. See
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

The deterministic Traefik gate is required in CI and uses only disposable
fake-Immich state. The optional live operator check is separate and requires
an operator-owned Immich v3.1.0 share plus DNS/TLS for both hosts; it is not a
CI prerequisite:

```sh
npx playwright install --with-deps chromium
npm run check
npm run build
npm run test:e2e
# Optional, only with operator-provided live endpoint and disposable share:
PLAYWRIGHT_BASE_URL=https://pages.example.xyz npm run e2e -- tests/e2e/direct-share.spec.ts
```

The browser test starts the disposable Pages/fake-Immich/Traefik topology,
uses the published `pages.example.xyz:18080` entrypoint, and tears it down
with volumes and orphans. It intentionally fails if Chromium is absent; it
does not silently switch browsers. TLS is checked separately against the
production Traefik deployment.

Svelte MCP and component tooling are development-only conveniences. Configure
the official Svelte MCP locally (for example with `npx -y @sveltejs/mcp`) and
do not add it to the runtime image or treat it as a user setup requirement.

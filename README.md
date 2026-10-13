# Immich Pages

Immich Pages is a stateless, read-only SvelteKit presentation layer. Immich is
the sole CMS and source of truth for albums, descriptions, assets, metadata,
sharing, and authorization. Pages reconstructs a presentation from each
request; it has no database, media store, page index, or correctness-critical
volume. Deleting and recreating the container therefore does not delete pages.
The current compatibility target is Immich v3.3.1.

## Share URL and proxy contract

The supported public grammar is exactly:

```text
https://pages.example.xyz/share/key/<opaque-ref>
https://pages.example.xyz/share/slug/<opaque-ref>
```

`key` and `slug` are explicit route kinds; Pages never guesses between them.
Traefik redirects `/share/` requests received on `immich.example.xyz` to the
Pages host. Viewers remain on Pages: upstream URLs, login pages, media URLs,
cookies, and response details are never relayed. Only the visitor's
incoming `Cookie` and `Authorization` reach the configured `IMMICH_BASE_URL`;
Pages never synthesizes an owner/API key credential.

Password handoff is delegated to Immich and stored only as a bounded,
host-scoped encrypted Pages session. Every page and media request revalidates
the share. A valid ordinary album share is a branded non-page result, not an
Immich redirect; ordinary Immich root paths remain outside the Pages router.

## Quick Start With Docker Compose

This setup runs Pages alongside `immich-server`, Redis, and Postgres in one
Compose project. It assumes Traefik already watches the external `images`
network and has a `websecure` entrypoint with a `letsencrypt` certificate
resolver.

1. Copy this repository, or download [`docker-compose.yml`](docker-compose.yml)
   and the `Dockerfile` into the same directory.
2. Create the shared network and environment file:

```sh
docker network create images 2>/dev/null || true
cp .env.example .env
```

3. Edit `.env` and set `IMMICH_HOST`, `PAGES_HOST`, `DB_PASSWORD`, and
   `PAGES_SESSION_SECRET`. The two hostnames must resolve to this Traefik host.
4. Start the stack:

```sh
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
```

Open `https://<pages-host>/share/key/<share-key>` for a Pages presentation. A
native Immich share opened from `https://<immich-host>/share/<share-key>` is
permanently redirected to `https://<pages-host>/share/key/<share-key>`, including
its query string. Normal Immich URLs remain on Immich.

The included [`docker-compose.yml`](docker-compose.yml) contains the complete
minimal stack and the required Traefik labels. It excludes unrelated services,
uses no owner/API key credential for Pages, and parameterizes hostnames, secrets,
and storage paths. See [`docs/deployment.md`](docs/deployment.md) for TLS,
reverse-proxy, recovery, and security details.

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
an operator-owned Immich v3.3.1 share plus DNS/TLS for both hosts; it is not a
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

Most Playwright specs (`npm run test:e2e:mock`) run against
`tests/e2e/mock-immich-server.mjs`, a hand-rolled HTTP mock that fabricates
asset bytes -- enough to exercise routing, caching, and control-plane logic,
but not real image decoding. For specs that need to prove Pages actually
decodes and renders real photos, `npm run test:e2e:real-immich` runs the same
Playwright flow against a real, disposable Immich instance instead (Postgres +
Redis + `immich-server`, seeded via Immich's own REST API, auto torn down on
exit). See [`tests/e2e/real-immich/README.md`](tests/e2e/real-immich/README.md)
for setup, manual (non-ephemeral) use, and known findings.

For manual browsing against that real fixture (`npm run dev` pointed at the
stack's `IMMICH_BASE_URL`, not the mock), the seeded forward-order album is
reachable at `/share/slug/e2e-forward` -- a stable URL that survives reseeds.
`tests/e2e/real-immich/README.md`'s "Configured albums/slugs" table lists every
other seeded album (reverse order, BRouter routing, markdown, gradients, map
clustering disabled).

Svelte MCP and component tooling are development-only conveniences. Configure
the official Svelte MCP locally (for example with `npx -y @sveltejs/mcp`) and
do not add it to the runtime image or treat it as a user setup requirement.

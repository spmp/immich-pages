# Deployment and operations

## Trust and topology

Immich remains the sole persistent source of truth and authorization boundary.
Pages is read-only and stateless: it stores no albums, credentials, sessions,
media, or page configuration. Every response is rebuilt from the request and
Immich. Caches, if introduced later, are optimizations and must be disposable.

Use separate hosts:

```text
 pages.example.xyz         -- Traefik Host router --> Pages:3000
 immich.example.xyz/share  -- Traefik redirect --> pages.example.xyz/share
 Pages                     -- IMMICH_BASE_URL ----> https://immich.example.xyz
```

The exact Pages routes are `/share/key/<opaque-ref>` and
`/share/slug/<opaque-ref>`. Immich share links must redirect viewers to the Pages
host; do not proxy or internally replace the Immich host for share requests.

## Environment and container

Set `IMMICH_BASE_URL` to the explicit trusted Immich origin. Set
`PUBLIC_PAGES_DEBUG=false` in production to disable safe browser lifecycle
diagnostics; diagnostics are enabled by default when unset for development
review.
`IMMICH_SUPPORTED_VERSION=3.1.0` so `/health/immich` checks the current Immich
release target. Do not set an owner credential or API key for visitor rendering.
The adapter-node image is a
multi-stage Node 24 image, listens on port 3000, and runs as non-root with
`node build`. The production Compose file has one service and no database,
media, or correctness volume.

`PAGES_LOCATOR_SECRET` is required for authenticated library locators. Generate
it with a cryptographically secure random generator, for example:

```sh
openssl rand -base64 32
```

Put the generated value in the operator-managed `.env` as
`PAGES_LOCATOR_SECRET`; do not copy it into Compose, source control, URLs, or
logs. Keep the same value across container recreation and stateless rebuilds so
existing library links continue to work. Rotating it is supported, but changing
it invalidates previously issued library locators and requires users to open the
library again. Keep it separate from `PAGES_SESSION_SECRET`.

`PAGES_VISITED_SHARES_SECRET` is also required for the encrypted, bounded
visited-share registry. Generate a separate stable random value and keep it
separate from both session and locator secrets. The registry stores only
validated share kind/reference pairs; it never grants access or stores visitor
credentials.

This secret protects the integrity and confidentiality of routing handles only;
it is not a visitor credential and does not grant Immich access. Every locator
destination is freshly authorized against Immich using the visitor's current
session. Direct-share `/share/key/...` and `/share/slug/...` paths remain a
separate authorization mode.

```sh
cp .env.example .env
# edit .env and set IMMICH_BASE_URL=https://immich.example.xyz
docker compose up -d --build
docker compose ps
```

Check the configuration without printing secret values:

```sh
docker compose config >/dev/null
```

Recovery is a normal rebuild. `docker compose down --volumes` followed by
`docker compose up -d --build` must reproduce pages from Immich alone.

## Proxy requirements

Traefik must use an HTTPS router equivalent to
`Host(`pages.example.xyz`)` with TLS and a configured certificate resolver,
and must send traffic to the Pages container port 3000. Configure the adapter
to consume `X-Forwarded-Proto` and `X-Forwarded-Host` only through this trusted
Traefik path; do not expose those headers as trusted input on a direct public
Pages port.

The request contract is deliberately narrow:

* preserve the route query string;
* forward the visitor `Cookie` and `Authorization` headers only when present;
* preserve the public host/protocol context through Traefik;
* never relay Immich `Set-Cookie` to the Pages host;
* do not log keys, cookies, authorization values, passwords, or secret media URLs.

Media remains a same-origin Pages concern. The browser receives only a
`/share/<key-or-slug>/<ref>/media/<asset-id>/thumbnail` reference; Pages
re-resolves the share and checks asset membership before forwarding the
thumbnail request to Immich. There is no API-key fallback, direct Immich media
URL, original/download proxy, or credential persistence.

### Immich share redirect

Add this higher-priority router and middleware to the Immich service's Traefik
labels. These labels belong on the Immich router, not the Pages service:

```yaml
labels:
  traefik.http.routers.immich-share-to-pages.rule: Host(`immich.example.xyz`) && PathPrefix(`/share`)
  traefik.http.routers.immich-share-to-pages.priority: 100
  traefik.http.routers.immich-share-to-pages.entrypoints: websecure
  traefik.http.routers.immich-share-to-pages.tls: true
  traefik.http.routers.immich-share-to-pages.middlewares: immich-share-redirect
  traefik.http.routers.immich-share-to-pages.service: immich
  traefik.http.middlewares.immich-share-redirect.redirectregex.regex: '^https://immich\.example\.xyz/share/(.*)'
  traefik.http.middlewares.immich-share-redirect.redirectregex.replacement: 'https://pages.example.xyz/share/key/$${1}'
  traefik.http.middlewares.immich-share-redirect.redirectregex.permanent: true
```

The redirect preserves the query string because the replacement does not define
one. Keep the normal Immich router for all other paths. If the deployment uses
file-based Traefik configuration instead of Docker labels, create the equivalent
`redirectRegex` middleware and `/share` router with a higher priority than the
normal Immich router.

Validate TLS separately in production, including the certificate, HTTPS
redirect/entrypoint, the Immich-to-Pages redirect, and deep links such as
`/share/key/fixture?view=gallery`. A deep link must reach Pages rather than a
Traefik or static-file 404.

## Health and safe outcomes

`GET /health` is a cheap process-only readiness endpoint and contains no
Immich or page data. `GET /health/immich` performs only the supported
`/api/server/version` probe and exposes renderer version, observed Immich
version, compatibility, and a redacted failure category. It never returns
album IDs, share references, private metadata, raw upstream bodies, or
credentials.

The direct-share route maps not-found, unauthorized, password-required,
unsupported, non-page, invalid-metadata, and upstream errors to safe public
responses. Detailed diagnostics belong in structured redacted logs. Request
authorization is never persisted or reused for another request.

## Coverage and exclusions

Phase 1 covers shared-link lookup, explicit key/slug normalization, request
authorization forwarding, album/assets/capability projection, thumbnail/view
references, version probing, and renderer health. It intentionally excludes
password login, asset pagination, maps/GPS, video/original proxying,
downloads, authenticated album enumeration, shared-link enumeration, and all
album/asset mutation. Full release and stateless-recreate gates are separate
commands and target `immich-server:v3.1.0`.

## Verification

```sh
npm run check && npm run build
npx playwright install --with-deps chromium
npm run test:e2e -- tests/e2e/direct-share.spec.ts
```

The E2E fixture is disposable and uses the real Traefik HTTP entrypoint, not a
local Pages harness. The production TLS check remains an operator deployment
check because the fixture intentionally uses HTTP on host port 18080.

Svelte MCP and component inspection tools are for development/agents only;
they are not required by the deployed service and must not receive production
credentials.

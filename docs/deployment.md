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

Pages needs exactly three settings. Everything else has a working default, either
in the code or baked into the image.

| Required | What it is |
|---|---|
| `IMMICH_BASE_URL` | The trusted Immich origin, e.g. `https://immich.example.xyz`. Pages forwards only the visitor's own cookie and authorization to it, never an owner credential or API key. |
| `PAGES_SESSION_SECRET` | Encrypts the saved Immich access for password-protected shares. At least 32 characters: `openssl rand -hex 32`. |
| `PAGES_VISITED_SHARES_SECRET` | Encrypts the visitor's library cookie (the list of shares this browser has opened). A different random value: `openssl rand -hex 32`. |

Keep both secrets stable: changing one only invalidates what it protects (saved
password access, or every visitor's library list respectively). Neither secret
grants access to anything; every share is freshly authorized against Immich on
every request. The library cookie stores only validated share kind/reference
pairs, never visitor credentials.

Optional settings, with their defaults:

| Setting | Default | Purpose |
|---|---|---|
| `MAP_STYLE_URL_QUIET_ATLAS` | `https://tiles.openfreemap.org/styles/liberty` | MapLibre style for the `quiet-atlas` map style. Deployment-owned; album descriptions cannot supply a style URL. |
| `PAGES_ALL_ALBUMS_ARE_PAGES` | `false` | Treat every accessed album as a page, even without an `immich-presentation` key (see below). |
| `IMMICH_SUPPORTED_VERSION` | `3.3.1` | Immich release that `/health/immich` checks against. |
| `PUBLIC_PAGES_DEBUG` | `false` | Bounded, redacted browser lifecycle diagnostics relayed to the server log. For troubleshooting only. |
| `BROUTER_ENDPOINT` / `BROUTER_ALLOWED_ORIGINS` | `https://brouter.de/brouter` / `https://brouter.de` | Router used for `map.source: brouter-web` routes. |
| `BROUTER_MAX_TOTAL_MS` | `15000` | How long one page load waits for a route; resolution continues in the background and is cached for the next load. |
| `BROUTER_MAX_RESPONSE_BYTES` | `4194304` | Largest reply accepted for one leg of a route (about 8,500 km of road). |
| `BROUTER_CACHE_ENABLED` | `true` | In-memory route caching. |
| `HDR_CACHE_TTL_MS` | `600000` | How long generated HDR media, and resolved routes, are kept in memory. |
| `HDR_PREWARM_LOOKAHEAD` | `10` | Photos converted ahead of the viewer; `all` for the whole album. |
| `HDR_PREWARM_INDICATOR` | `on` | The readiness dot on the share page. |
| `HDR_CACHE_BACKEND` | `memory` | `disk` also keeps generated HDR media in `HDR_CACHE_DIRECTORY`, so it survives restarts and more of it can be kept. Memory stays the fast tier. |
| `HDR_CACHE_DIRECTORY` | unset | Directory for the disk tier; required for `disk`. Mount a volume here. Without a writable directory Pages logs a warning and uses memory only. |
| `HDR_CACHE_DISK_MAX_BYTES` | `2147483648` | Size budget for the disk tier (2 GB); least recently used media is removed first. |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | Listen address (set in the image). |
| `PROTOCOL_HEADER` / `HOST_HEADER` | `X-Forwarded-Proto` / `X-Forwarded-Host` | How Pages learns its public origin behind a reverse proxy (set in the image; see Proxy requirements). |
| `ORIGIN` | unset | Pin a fixed public origin, e.g. `https://pages.example.xyz`, instead of reading it from proxy headers. |

The disk tier is an optimization, not state: deleting the directory only means
photos are converted again on their next view. Nothing in it is served without
the request first being authorized against Immich, and files are named by a hash
of the cache key, so album content never chooses a path. For example:

```yaml
pages:
  environment:
    HDR_CACHE_BACKEND: disk
    HDR_CACHE_DIRECTORY: /cache/hdr
  volumes:
    - ./pages-cache:/cache
```

The container runs as the `node` user (uid 1000), so the mounted directory must
be writable by it.

Further `HDR_*` and `SDR_*` limits (cache sizes, concurrency, conversion
timeouts) exist for tuning; their defaults suit a small server.

The adapter-node image is a multi-stage Node 24 image, listens on port 3000,
and runs as non-root with `node build`. The production Compose file has one
service and no database, media, or correctness volume.

Set `PAGES_ALL_ALBUMS_ARE_PAGES=true` to treat every accessed album as a page
using full presentation defaults, even with no `immich-presentation` key in
its description at all. Default `false`: explicit per-album opt-in (adding an
`immich-presentation` key to the album description) remains the default
activation model. This never suppresses a real authoring error -- an album
whose `immich-presentation` block is present but malformed still surfaces
`invalid-metadata` regardless of this setting.

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

## External build watcher

For deployments where the Docker build runs outside the development container,
`scripts/watch-compose-rebuild.sh` can keep a Compose project updated from a
simple trigger file. It prefers `inotifywait` and falls back to polling:

```sh
chmod +x scripts/watch-compose-rebuild.sh
scripts/watch-compose-rebuild.sh \
  --compose-file /srv/immich-pages/docker-compose.yml \
  --service pages \
  --watch-dir /srv/immich-pages/rebuild \
  --trigger-file rebuild \
  --status-file /srv/immich-pages/rebuild/status
```

Touch `/srv/immich-pages/rebuild/rebuild` to trigger a build and a forced
recreation of only the selected service. `--no-deps` prevents Compose from
starting or recreating its declared dependencies; existing dependencies remain
running. The trigger remains present when a step fails and is removed only after
the service starts successfully. The status file contains `waiting`,
`building`, `starting`, `ready`, `failed`, or `stopped`; status
writes are atomic so another process can read it safely. It also records the
resolved `watch_dir` and `trigger_path`, which is useful when those paths are
bind-mounted from another host. Keep the status file
outside the watched directory when using a broad watch directory, or use the
default trigger name so status changes are ignored.

## Proxy requirements

Traefik must use an HTTPS router equivalent to
`Host(`pages.example.xyz`)` with TLS and a configured certificate resolver,
and must send traffic to the Pages container port 3000. The image reads the
public protocol and host from `X-Forwarded-Proto` and `X-Forwarded-Host`
(falling back to the `Host` header and `https`), which Traefik sets by default.
Pages uses its public origin only to check that form posts come from itself, so
it must match what visitors' browsers see. Keep the Pages port off the public
internet so only Traefik reaches it, or set `ORIGIN` to pin the origin and
ignore forwarded headers entirely.

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

Add this higher-priority router and the two middlewares to the Immich service's
Traefik labels; they belong on the Immich router, not the Pages service. Long
share links (`/share/<key>`) and short slug links (`/s/<slug>`) both go to
Pages. Each middleware acts only when its own pattern matches, so one router
serves both:

```yaml
labels:
  traefik.http.routers.immich-share-to-pages.rule: "Host(`immich.example.xyz`) && (PathPrefix(`/share/`) || PathPrefix(`/s/`))"
  traefik.http.routers.immich-share-to-pages.priority: 100
  traefik.http.routers.immich-share-to-pages.entrypoints: websecure
  traefik.http.routers.immich-share-to-pages.tls: true
  traefik.http.routers.immich-share-to-pages.middlewares: "immich-share-key-redirect,immich-share-slug-redirect"
  traefik.http.routers.immich-share-to-pages.service: immich
  traefik.http.middlewares.immich-share-key-redirect.redirectregex.regex: "^https://immich\\.example\\.xyz/share/(.+)"
  traefik.http.middlewares.immich-share-key-redirect.redirectregex.replacement: "https://pages.example.xyz/share/key/$${1}"
  traefik.http.middlewares.immich-share-slug-redirect.redirectregex.regex: "^https://immich\\.example\\.xyz/s/(.+)"
  traefik.http.middlewares.immich-share-slug-redirect.redirectregex.replacement: "https://pages.example.xyz/share/slug/$${1}"
```

Use the trailing slashes in the path prefixes: a bare `/s` would also match
Immich's own `/search` and `/sharing` pages. Add
`redirectregex.permanent: true` to each middleware only once the mapping is
settled; browsers cache a permanent redirect indefinitely.

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
commands and target `immich-server:v3.3.1`.

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

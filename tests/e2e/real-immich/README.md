# Real-Immich E2E fixture

A real, dockerized Immich instance (Postgres + Redis + `immich-server`, no
`immich-machine-learning` service and `IMMICH_MACHINE_LEARNING_ENABLED=false`) used as
the backend for Playwright E2E tests that need to prove Pages actually decodes and
renders real images -- something `tests/e2e/mock-immich-server.mjs` cannot do, since it
fabricates fake byte content rather than serving real decodable photos.

This stack is for E2E fixture use only. It is disposable, local-only, and must never be
pointed at real user data or exposed beyond localhost.

## Pinned version

`IMMICH_VERSION=v3.3.1` (latest release at authoring time, 2026-10-12). Image tags/
digests for Postgres and Redis are copied verbatim from Immich's own
`docker/docker-compose.yml` and `e2e/docker-compose.yml` on `main` -- not guessed.

To bump the pinned version: update the `IMMICH_VERSION` default in `docker-compose.yml`,
re-run `seed.mjs` against a fresh stack, and re-verify the OpenAPI-spec diff step still
passes (see `seed.mjs`'s step 0).

## Commands

```sh
cd tests/e2e/real-immich
docker compose up -d       # start Postgres, Redis, immich-server
docker compose down        # stop and remove containers, keep the immich-upload volume
docker compose down --volumes  # also wipe the immich-upload volume for a full reset
```

The fixture library is mounted read-only from `tests/resources/heic-test-set/originals/`
(the 20 real HEIC photos; not the sibling `thumbnails-webp/`/zip files, which are not
asset originals) into the `immich-server` container at `/external/heic-originals` --
Immich indexes it as a Library pointed at an import path (created by `seed.mjs`), never
copying the files into its own upload volume. Note: in Immich v3.3.1 there is no
`type: EXTERNAL` field on library creation -- all libraries created via `POST /api/libraries`
are import-path-based; confirmed against the live OpenAPI spec, not assumed from older docs.

## Seeding

Run `node seed.mjs` against an already-up stack (see `../run-real-immich.mjs` for the
full orchestrated flow: compose up -> seed -> dev server -> Playwright -> teardown).
`seed.mjs` is idempotent -- re-running it against an already-seeded stack reuses existing
resources rather than erroring or duplicating them.

Throwaway local-only admin credentials used by `seed.mjs` (never real secrets, only valid
against this disposable local stack):

- email: `e2e-admin@immich-pages.test`
- password: `ImmichPagesE2E!2026`

## Findings

**OpenAPI spec location (confirmed live, 2026-10-12, v3.3.1):** `GET /api/spec.json`,
NOT `/api/doc/json` as originally assumed when this plan was authored without live API
access. `/api/doc/json` and `/doc/json` both return the web app's SPA HTML (200, wrong
content-type), not JSON -- a silent-looking trap if the response body isn't checked.
Immich's own `SwaggerModule.setup` overrides `jsonDocumentUrl` to `/api/spec.json`
explicitly, confirmed by reading `server/src/utils/misc.ts` in the pinned version's source.

**Library creation has no `type` field (confirmed live):** `CreateLibraryDto` has no
`type: EXTERNAL | UPLOAD` discriminator in v3.3.1 -- every library created via
`POST /api/libraries` is import-path-based. The "External Library" terminology from
older Immich docs/community posts does not correspond to a field in this version's API.

**Manual album-asset ordering does not exist in the live API (confirmed live):**
`PUT /api/albums/{id}/assets` has no `order`/`position`/similar field. This corroborates
`.planning/debug/hdr-caching-uat-20261010.md`'s prior web-research finding with direct
API-shape evidence from a real running server, not secondhand reporting.

**The "empty assets" shape is REAL, reproducible, default Immich behavior -- not a
user-deployment quirk (confirmed live, 2026-10-12):** `GET /api/shared-links/me?key=...`
for a freshly created, default-configuration ALBUM share on a stock v3.3.1 server
returns `"assets": []` (present, empty) and the `album` object has **no `assets` key at
all** (not `null`, not `[]` -- entirely absent from the serialized response), even though
`album.assetCount` correctly reports 20. Full captured response:

```json
{
  "assets": [],
  "album": {
    "albumName": "immich-pages-e2e-forward",
    "id": "c92ac361-ea3a-4be6-9361-42108a3d159f",
    "assetCount": 20,
    "order": "desc"
    /* ... no "assets" key anywhere in the album object ... */
  }
}
```

`src/lib/server/immich/provider.ts`'s existing `getSharedLink`/`fetchAlbumAssets` fallback
(added in an earlier session, before real-server access existed to confirm it) already
handles this exact shape correctly: when `selectAuthoritativeAlbumAssets([], undefined)`
returns `[]`, it falls back to `POST /api/search/metadata` with `{ albumIds: [albumId],
order: album.order }`, which **was verified against this real server** to return all 20
real assets in the requested order (`order: "desc"` -> `20.HEIC, 19.HEIC, 18.HEIC, ...`).
This is the first real-server confirmation that the fallback path this whole session's
HDR investigation was built around is not just plausible but necessary and correct.

**Consequence for 08-22's own Task 2 acceptance criterion:** the criterion as originally
written ("fetched directly via curl .../shared-links/me?key=<key>, returns a 200 with a
real, non-empty `assets` or `album.assets` array") is impossible to satisfy literally
against a real server -- this is default behavior, not a fixable test setup issue.
Verified instead via the equivalent, actually-meaningful check: the same
`POST /api/search/metadata` fallback call `fetchAlbumAssets` makes, which does return the
real, non-empty, correctly ordered asset list. Recorded as a deviation rather than
silently weakening the criterion.

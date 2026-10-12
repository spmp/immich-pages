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

The fixture library is mounted read-only from `tests/resources/heic-test-set/` into the
`immich-server` container at `/external/heic-test-set` -- Immich indexes it as an
External Library (created by `seed.mjs`), never copying the files into its own upload
volume.

## Seeding

Run `node seed.mjs` against an already-up stack (see `../run-real-immich.mjs` for the
full orchestrated flow: compose up -> seed -> dev server -> Playwright -> teardown).
`seed.mjs` is idempotent -- re-running it against an already-seeded stack reuses existing
resources rather than erroring or duplicating them.

Throwaway local-only admin credentials used by `seed.mjs` (never real secrets, only valid
against this disposable local stack):

- email: `e2e-admin@immich-pages.test`
- password: `ImmichPagesE2E!2026`

## Findings (filled in by Task 2/Task 4 execution)

<!-- Task 2 records here whether the real API supports manual album-asset ordering. -->
<!-- Task 4 records here the real /api/shared-links/me response shape for an ALBUM share. -->

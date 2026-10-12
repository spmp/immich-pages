#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Idempotent REST API seed script for the real-Immich E2E fixture. Mirrors
// immich-app/immich's own e2e/src/utils.ts pattern (signUpAdmin -> login ->
// createApiKey -> createLibrary -> createAlbum) against a real server, not a
// database dump. All field names below were confirmed against the LIVE
// OpenAPI spec (step 0) for the pinned v3.3.1 server, not assumed from
// immich-app/immich's e2e/src/utils.ts, which tracks main/HEAD and may be
// ahead of the pinned release.

const BASE_URL = process.env.IMMICH_BASE_URL ?? 'http://127.0.0.1:4101';
const ADMIN_EMAIL = 'e2e-admin@immich-pages.test';
const ADMIN_PASSWORD = 'ImmichPagesE2E!2026';
const ADMIN_NAME = 'E2E Admin';
const LIBRARY_NAME = 'immich-pages-e2e-fixture';
const LIBRARY_IMPORT_PATH = '/external/heic-originals';
const EXPECTED_ASSET_COUNT = 20;
const SCAN_TIMEOUT_MS = 60_000;

async function api(basePath, { method = 'GET', body, accessToken } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers['authorization'] = `Bearer ${accessToken}`;
  const response = await fetch(`${BASE_URL}/api${basePath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  if (!response.ok) {
    throw new Error(`${method} /api${basePath} -> ${response.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  }
  return json;
}

// Step 0 (enforced, not just a read_first hint -- see 08-22-PLAN-CHECK.md BLOCKER-2):
// fetch the live OpenAPI spec and confirm every endpoint/field this script depends on
// is actually present on the server we are about to seed, BEFORE issuing any request
// built on an assumed shape.
async function verifyLiveApiShapeOrThrow() {
  console.log('[seed] step 0: fetching live OpenAPI spec (/api/spec.json) to verify field shapes before any request...');
  const specResponse = await fetch(`${BASE_URL}/api/spec.json`);
  if (!specResponse.ok) {
    throw new Error(`[seed] step 0 FAILED: GET /api/spec.json -> ${specResponse.status}. Cannot verify API shape; refusing to guess.`);
  }
  const spec = await specResponse.json();

  const requiredEndpoints = [
    ['/auth/admin-sign-up', 'post'],
    ['/auth/login', 'post'],
    ['/api-keys', 'post'],
    ['/libraries', 'post'],
    ['/libraries', 'get'],
    ['/libraries/{id}/scan', 'post'],
    ['/libraries/{id}/statistics', 'get'],
    ['/search/metadata', 'post'],
    ['/albums', 'post'],
    ['/albums', 'get'],
    ['/albums/{id}/assets', 'put'],
    ['/shared-links', 'post'],
    ['/shared-links', 'get'],
    ['/shared-links/me', 'get'],
    ['/jobs', 'get']
  ];
  const missing = requiredEndpoints.filter(([path, method]) => !spec.paths?.[path]?.[method]);
  if (missing.length > 0) {
    throw new Error(
      `[seed] step 0 FAILED: live server is missing endpoint(s) this script depends on: ${JSON.stringify(missing)}. ` +
        `Immich's API shape has changed since this script was authored against v3.3.1 -- update seed.mjs against the live spec, do not proceed on a guess.`
    );
  }

  const schemaOf = (ref) => spec.components.schemas[ref.replace('#/components/schemas/', '')];
  const createLibrarySchema = schemaOf('#/components/schemas/CreateLibraryDto');
  const hasLibraryTypeField = Boolean(createLibrarySchema?.properties?.type);

  const putAssetsSchemaRef = spec.paths['/albums/{id}/assets'].put.requestBody.content['application/json'].schema;
  const putAssetsSchema = putAssetsSchemaRef.$ref ? schemaOf(putAssetsSchemaRef.$ref) : putAssetsSchemaRef;
  const supportsManualAlbumOrder = Object.keys(putAssetsSchema?.properties ?? {}).some((key) => /order/i.test(key));

  console.log(
    `[seed] step 0 OK. CreateLibraryDto has 'type' field: ${hasLibraryTypeField} ` +
      '(expected false on v3.3.1 -- all libraries are import-path based; no EXTERNAL/UPLOAD distinction in this version). ' +
      `PUT /albums/{id}/assets supports manual ordering: ${supportsManualAlbumOrder} ` +
      '(expected false -- confirms prior session research that Immich has no per-asset album-order API at any version).'
  );

  return { hasLibraryTypeField, supportsManualAlbumOrder };
}

async function ensureAdminAndLogin() {
  console.log('[seed] ensuring admin account exists...');
  try {
    await api('/auth/admin-sign-up', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME } });
    console.log('[seed] admin account created.');
  } catch (error) {
    console.log(`[seed] admin sign-up skipped (likely already initialized): ${error.message}`);
  }
  console.log('[seed] logging in...');
  const session = await api('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  return session; // { accessToken, userId, ... }
}

async function ensureApiKey(accessToken) {
  // Created for fidelity with the plan's must_haves ("API key... created via Immich's own
  // REST API"). Its secret is not reused across runs -- this script authenticates with the
  // login bearer token throughout, so idempotency does not depend on persisting the secret.
  console.log('[seed] ensuring API key exists...');
  try {
    const created = await api('/api-keys', { method: 'POST', accessToken, body: { name: 'immich-pages-e2e-seed', permissions: ['all'] } });
    console.log(`[seed] API key created (id=${created.id}).`);
  } catch (error) {
    console.log(`[seed] API key creation skipped: ${error.message}`);
  }
}

async function ensureLibrary(accessToken, ownerId) {
  console.log('[seed] ensuring library exists...');
  const libraries = await api('/libraries', { accessToken });
  const existing = libraries.find((library) => library.name === LIBRARY_NAME);
  if (existing) {
    console.log(`[seed] library already exists (id=${existing.id}).`);
    return existing;
  }
  const created = await api('/libraries', {
    method: 'POST',
    accessToken,
    body: { ownerId, name: LIBRARY_NAME, importPaths: [LIBRARY_IMPORT_PATH] }
  });
  console.log(`[seed] library created (id=${created.id}).`);
  return created;
}

async function scanAndWaitForAssets(accessToken, libraryId) {
  console.log('[seed] triggering library scan...');
  await api(`/libraries/${libraryId}/scan`, { method: 'POST', accessToken });

  console.log(`[seed] polling for ${EXPECTED_ASSET_COUNT} scanned assets (timeout ${SCAN_TIMEOUT_MS}ms)...`);
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  let lastTotal = -1;
  while (Date.now() < deadline) {
    const stats = await api(`/libraries/${libraryId}/statistics`, { accessToken });
    lastTotal = stats.total;
    if (stats.total >= EXPECTED_ASSET_COUNT) {
      console.log(`[seed] scan complete: ${stats.total} assets.`);
      await waitForThumbnailsToExist(accessToken, libraryId);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `[seed] library scan did not reach ${EXPECTED_ASSET_COUNT} assets within ${SCAN_TIMEOUT_MS}ms (last seen: ${lastTotal}). ` +
      'Check that tests/resources/heic-test-set/originals/ contains real HEIC files, not placeholders, and that the Docker mount is correct.'
  );
}

// Asset count alone is not sufficient: Immich reports an asset as scanned as soon as metadata
// extraction finishes, but its thumbnail (what Pages actually serves) is generated by a
// SEPARATE, slower async job enqueued afterward. Confirmed the hard way: a direct thumbnail
// GET 404'd ("Asset media not found") for several seconds after /libraries/{id}/statistics
// already reported the full count, and checking GET /api/jobs immediately after the count
// settled unreliably read the queue as already-empty (a race against the job runner enqueueing
// the next stage) -- so this polls the actual thumbnail endpoint for one real asset directly,
// which is the real completion signal this script (and Pages) cares about.
async function waitForThumbnailsToExist(accessToken, libraryId) {
  console.log('[seed] waiting for thumbnail generation to catch up...');
  const result = await api('/search/metadata', { method: 'POST', accessToken, body: { libraryId, page: 1, size: 1 } });
  const probeAssetId = result.assets.items[0]?.id;
  if (!probeAssetId) throw new Error('[seed] no asset available to probe thumbnail readiness.');

  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE_URL}/api/assets/${probeAssetId}/thumbnail`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (response.ok) {
      console.log('[seed] thumbnails ready.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`[seed] thumbnail for probe asset ${probeAssetId} did not become available within ${SCAN_TIMEOUT_MS}ms.`);
}

async function fetchLibraryAssetsSortedByFileName(accessToken, libraryId) {
  const result = await api('/search/metadata', { method: 'POST', accessToken, body: { libraryId, size: EXPECTED_ASSET_COUNT + 10 } });
  const assets = result.assets.items;
  if (assets.length < EXPECTED_ASSET_COUNT) {
    throw new Error(`[seed] expected at least ${EXPECTED_ASSET_COUNT} scanned assets, found ${assets.length}.`);
  }
  return [...assets].sort((a, b) => a.originalFileName.localeCompare(b.originalFileName));
}

// Mirrors src/lib/server/immich/provider.ts's fetchAlbumAssets exactly (same endpoint,
// same params, same order source) so seed-output.json records asset IDs in the SAME order
// Pages will actually render them -- Immich's album `order` field is a global display
// direction (confirmed `desc` by default, independent of asset insertion order or album
// name), not something this script's own forward/reverse album-creation order controls.
async function fetchDisplayOrderAssetIds(accessToken, albumId) {
  const album = await api(`/albums/${albumId}`, { accessToken });
  const result = await api('/search/metadata', {
    method: 'POST',
    accessToken,
    body: { albumIds: [albumId], page: 1, size: 1000, order: album.order ?? 'desc' }
  });
  return result.assets.items.map((asset) => asset.id);
}

async function ensureAlbum(accessToken, name, assetIds) {
  console.log(`[seed] ensuring album "${name}" exists...`);
  const albums = await api('/albums', { accessToken });
  const existing = albums.find((album) => album.albumName === name);
  if (existing) {
    console.log(`[seed] album "${name}" already exists (id=${existing.id}).`);
    return existing;
  }
  // Pages only treats an album as a publishable "journey" presentation when its Immich
  // description carries this exact YAML frontmatter (src/lib/server/presentation/frontmatter.ts)
  // -- confirmed by reading tests/e2e/mock-immich-server.mjs's own fixture descriptions, since
  // this plan's must_haves never named this gate explicitly and the first real-backend test run
  // hit "This is not a Pages journey" until this was added.
  const description = '---\nimmich-presentation:\n  type: journey\n  version: 1\n---\nimmich-pages-e2e fixture';
  const created = await api('/albums', { method: 'POST', accessToken, body: { albumName: name, description, assetIds } });
  console.log(`[seed] album "${name}" created (id=${created.id}).`);
  return created;
}

async function ensureUnauthenticatedSharedLink(accessToken, albumId, albumName) {
  console.log(`[seed] ensuring unauthenticated shared link for album "${albumName}"...`);
  const links = await api('/shared-links', { accessToken });
  const existing = links.find((link) => link.album?.id === albumId);
  if (existing) {
    console.log(`[seed] shared link for "${albumName}" already exists (key=${existing.key}).`);
    return existing;
  }
  const created = await api('/shared-links', { method: 'POST', accessToken, body: { type: 'ALBUM', albumId, password: null } });
  console.log(`[seed] shared link for "${albumName}" created (key=${created.key}).`);
  return created;
}

async function main() {
  const capabilities = await verifyLiveApiShapeOrThrow();

  const session = await ensureAdminAndLogin();
  const { accessToken, userId } = session;

  await ensureApiKey(accessToken);

  const library = await ensureLibrary(accessToken, userId);
  await scanAndWaitForAssets(accessToken, library.id);

  const sortedAssets = await fetchLibraryAssetsSortedByFileName(accessToken, library.id);
  const forwardIds = sortedAssets.map((asset) => asset.id);
  const reverseIds = [...forwardIds].reverse();

  const results = [];

  const forwardAlbum = await ensureAlbum(accessToken, 'immich-pages-e2e-forward', forwardIds);
  const forwardLink = await ensureUnauthenticatedSharedLink(accessToken, forwardAlbum.id, 'immich-pages-e2e-forward');
  results.push(forwardLink);

  const reverseAlbum = await ensureAlbum(accessToken, 'immich-pages-e2e-reverse', reverseIds);
  const reverseLink = await ensureUnauthenticatedSharedLink(accessToken, reverseAlbum.id, 'immich-pages-e2e-reverse');
  results.push(reverseLink);

  if (capabilities.supportsManualAlbumOrder) {
    console.log('[seed] live API supports manual album-asset ordering -- creating scrambled-order album.');
    const scrambledIds = [...forwardIds.slice(10), ...forwardIds.slice(0, 10)];
    const scrambledAlbum = await ensureAlbum(accessToken, 'immich-pages-e2e-scrambled', scrambledIds);
    results.push(await ensureUnauthenticatedSharedLink(accessToken, scrambledAlbum.id, 'immich-pages-e2e-scrambled'));
  } else {
    console.log(
      '[seed] live API does NOT support manual album-asset ordering -- skipping scrambled-order album. ' +
        'This is an EXPECTED, PASSING outcome (confirms prior session research); see README.md.'
    );
  }

  // Reconnaissance for the "both assets and album.assets empty" shape is Task 4's job (it
  // needs to inspect a real /shared-links/me response in detail); this script does not
  // create a fourth album for it preemptively since that shape's reproducibility is exactly
  // what Task 4 is settling, not something to assume here.

  console.log('[seed] done. Shared link keys/slugs:');
  for (const link of results) {
    console.log(`  - ${link.key}`);
  }

  // Lets real-backend Playwright specs resolve real refs/asset IDs instead of the mock's
  // hardcoded fixtures. Gitignored runtime artifact, not committed source.
  const forwardDisplayOrder = await fetchDisplayOrderAssetIds(accessToken, forwardAlbum.id);
  const reverseDisplayOrder = await fetchDisplayOrderAssetIds(accessToken, reverseAlbum.id);
  const outputPath = fileURLToPath(new URL('./seed-output.json', import.meta.url));
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        forward: { ref: forwardLink.key, assetIds: forwardDisplayOrder },
        reverse: { ref: reverseLink.key, assetIds: reverseDisplayOrder }
      },
      null,
      2
    )
  );
  console.log(`[seed] wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

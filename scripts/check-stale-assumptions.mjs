import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

// This is deliberately explicit: adding a new active contract file requires adding it here.
export const SCAN_PATHS = [
  'src/lib/server/page/assemble.ts',
  'src/lib/server/immich/types.ts',
  'tests/e2e/direct-share.mock.spec.ts',
  'tests/e2e/mock-immich-server.mjs',
  'tests/e2e/traefik-fixture.mjs',
  'tests/fixtures/stateless/server.mjs',
  'tests/fixtures/shared-link/valid-page.json',
  'tests/fixtures/shared-link/malformed-response.json',
  'tests/integration/media-proxy.test.ts',
  'tests/tracer/direct-share-tracer.test.ts',
  'scripts/verify-immich-release.mjs',
  'tests/fixtures/immich/v3.1.0/server-version.json',
  'tests/fixtures/immich/v3.1.0/shared-link-contract.json',
  'tests/fixtures/immich/v3.1.0/contract-result.json'
];

// Only these two files contain intentional forbidden strings in their test/scanner logic.
export const SELF_EXCLUDED = new Set([
  'scripts/check-stale-assumptions.mjs',
  'tests/contracts/stale-assumptions.test.ts'
]);

const patterns = [
  { name: 'invented media field', pattern: /(?:thumbnail|view)Path/ },
  { name: 'direct Immich media source', pattern: /(?:src|media(?:Url|URL))\s*[:=][^\n]*(?:https?:\/\/[^\s'"`]+\/api\/assets|IMMICH_BASE_URL|\/api\/assets)/i },
  { name: 'API-key fallback', pattern: /(?:IMMICH_(?:OWNER_)?API_KEY|\b(?:ownerKey|apiKey)\b)/ },
  { name: 'active v1.143.1 evidence', pattern: /v1\.143\.1/ }
];

/** @param {string} text @param {string} path */
export function scanText(text, path) {
  return patterns.flatMap(({ name, pattern }) => pattern.test(text) ? [{ name, path }] : []);
}

export async function scanFiles(paths = SCAN_PATHS) {
  const violations = [];
  for (const relativePath of paths) {
    if (SELF_EXCLUDED.has(relativePath)) continue;
    const absolutePath = resolve(root, relativePath);
    if (!existsSync(absolutePath)) {
      violations.push({ name: 'missing manifest path', path: relativePath });
      continue;
    }
    violations.push(...scanText(await readFile(absolutePath, 'utf8'), relativePath));
  }
  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const violations = await scanFiles();
  if (violations.length) {
    for (const violation of violations) console.error(`${violation.path}: ${violation.name}`);
    process.exitCode = 1;
  } else {
    console.log(`stale-assumptions: passed (${SCAN_PATHS.length} manifest paths)`);
  }
}

import { describe, expect, it } from 'vitest';
import { SCAN_PATHS, SELF_EXCLUDED, scanFiles, scanText } from '../../scripts/check-stale-assumptions.mjs';

describe('stale-assumption guard', () => {
  it('scans an explicit active manifest and narrowly excludes only its own literals', async () => {
    expect(SCAN_PATHS).toEqual(expect.arrayContaining([
      'src/lib/server/page/assemble.ts',
      'src/lib/server/immich/types.ts',
       'tests/e2e/mock-immich-server.mjs',
       'tests/e2e/traefik-fixture.mjs',
       '.env.example',
       'compose.yaml',
       'README.md',
       'docs/deployment.md',
      'tests/fixtures/stateless/server.mjs',
      'tests/fixtures/shared-link/valid-page.json',
      'tests/fixtures/shared-link/malformed-response.json',
      'scripts/verify-immich-release.mjs'
    ]));
    expect(SELF_EXCLUDED).toEqual(new Set(['scripts/check-stale-assumptions.mjs', 'tests/contracts/stale-assumptions.test.ts']));
    expect(await scanFiles()).toEqual([]);
  });

  it.each([
    ['thumbnailPath', 'invented media field'],
    ['viewPath', 'invented media field'],
    ["src: 'https://immich.example/api/assets/id/thumbnail'", 'direct Immich media source'],
     ['IMMICH_API_KEY', 'API-key fallback'],
     ['immich-server:v1.143.1', 'active v1.143.1 evidence'],
     ['immich-server:v3.0.1', 'stale active v3.0.1 evidence']
  ])('rejects %s', (text, category) => {
    expect(scanText(text, 'synthetic')).toContainEqual({ name: category, path: 'synthetic' });
  });

  it('allows the Pages same-origin media boundary', () => {
    expect(scanText("thumbnail: '/share/key/ref/media/id/thumbnail'", 'synthetic')).toEqual([]);
  });

  it('keeps historical planning records outside the active manifest', () => {
    expect(SCAN_PATHS).not.toContain('01-09-SUMMARY.md');
    expect(SCAN_PATHS).not.toContain('01-CONTEXT.md');
    expect(SCAN_PATHS).not.toContain('01-RESEARCH.md');
    expect(SCAN_PATHS).not.toContain('.planning/phases/01-secure-immich-foundation-and-direct-share-slice/01-VERIFICATION.md');
  });
});

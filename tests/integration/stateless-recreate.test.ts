import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createImmichProvider } from '../../src/lib/server/immich/provider';
import { assembleDirectShare } from '../../src/lib/server/page/assemble';

describe('destructive stateless recreation harness', () => {
  it('uses disposable Compose resources and a direct-share projection comparison', () => {
    const compose = readFileSync('tests/fixtures/stateless/compose.yaml', 'utf8');
    const harness = readFileSync('scripts/test-stateless-recreate.mjs', 'utf8');
    const productionCompose = readFileSync('compose.yaml', 'utf8');
    expect(compose).not.toContain('pages-cache');
    expect(harness).not.toContain('cacheDir');
    expect(harness).not.toContain('disposable-cache');
    expect(compose).toContain('fake-immich:');
    expect(harness).toContain("down', '--volumes', '--remove-orphans");
    expect(harness).toContain('before.body !== after.body');
    expect(harness).toContain('Docker is required');
    expect(productionCompose).not.toMatch(/^\s+volumes:/m);
    expect(productionCompose).not.toMatch(/^\s+(?:db|database|media|postgres|redis):/m);
    expect(productionCompose).toContain('IMMICH_BASE_URL:');
  });

  it('accepts the current v3.1.0 fixture response and assembles a 200 page', async () => {
    const response = JSON.parse(readFileSync('tests/fixtures/stateless/shared-link-response.json', 'utf8'));
    const provider = createImmichProvider(vi.fn(async () => new Response(JSON.stringify(response))), 'https://immich.example');

    const result = await assembleDirectShare(provider, {
      shareRef: { kind: 'key', value: response.key },
      cookie: null,
      authorization: null
    }, 'stateless-regression');

    expect(result.kind).toBe('page');
    expect(response).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
      type: 'ALBUM',
      allowUpload: false,
      allowDownload: false,
      showMetadata: true,
      slug: null
    });
  });
});

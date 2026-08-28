import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('destructive stateless recreation harness', () => {
  it('uses disposable Compose resources and a direct-share projection comparison', () => {
    const compose = readFileSync('tests/fixtures/stateless/compose.yaml', 'utf8');
    const harness = readFileSync('scripts/test-stateless-recreate.mjs', 'utf8');
    expect(compose).not.toContain('pages-cache');
    expect(harness).not.toContain('cacheDir');
    expect(harness).not.toContain('disposable-cache');
    expect(compose).toContain('fake-immich:');
    expect(harness).toContain("down', '--volumes', '--remove-orphans");
    expect(harness).toContain('before.body !== after.body');
    expect(harness).toContain('Docker is required');
  });
});

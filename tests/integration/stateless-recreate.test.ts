import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('destructive stateless recreation harness', () => {
  it('uses Compose volumes and a direct-share projection comparison', () => {
    const compose = readFileSync('tests/fixtures/stateless/compose.yaml', 'utf8');
    const harness = readFileSync('scripts/test-stateless-recreate.mjs', 'utf8');
    expect(compose).toContain('pages-cache:');
    expect(compose).toContain('fake-immich:');
    expect(harness).toContain("down', '--volumes', '--remove-orphans");
    expect(harness).toContain('before.body !== after.body');
    expect(harness).toContain('Docker is required');
  });
});

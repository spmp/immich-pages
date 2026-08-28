import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import result from '../fixtures/immich/v1.143.1/contract-result.json';

describe('pinned Immich release contract', () => {
  it('records a complete fixture-only v1.143.1 contract', () => {
    expect(result).toMatchObject({
      image: 'immich-server:v1.143.1',
      mode: 'fixture',
      liveVerified: false,
      observedVersion: 'v1.143.1',
      status: 'passed',
      checks: {
        serverVersion: true,
        dtoFields: true,
        mediaReferences: true,
        requestScopedAuthorization: true,
        separateHost: true
      }
    });
  });

  it('does not allow fixture evidence to satisfy explicit live verification', () => {
    const script = 'scripts/verify-immich-release.mjs';
    expect(() => execFileSync(process.execPath, [script, '--live'], {
      cwd: process.cwd(),
      env: { ...process.env, IMMICH_RELEASE_BASE_URL: '' },
      stdio: 'pipe'
    })).toThrow();

    const liveResult = JSON.parse(readFileSync('tests/fixtures/immich/v1.143.1/contract-result.json', 'utf8'));
    expect(liveResult.mode).toBe('live');
    expect(liveResult.liveVerified).toBe(false);
    expect(liveResult.status).toBe('failed');
  });
});

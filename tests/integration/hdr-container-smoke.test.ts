import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const scripts = ['scripts/acquire-hdr-fixtures.mjs', 'scripts/hdr-fixture-matrix.mjs', 'scripts/verify-hdr-container.mjs', 'scripts/verify-docker-fixture-content.mjs'];

describe('production HDR container smoke contract', () => {
  it('keeps the harness textual, redacted, and fail-closed', () => {
    for (const script of scripts) {
      expect(existsSync(script)).toBe(true);
      const source = readFileSync(script, 'utf8');
      expect(source).not.toMatch(/console\.log\([^\n]*(?:password|cookie|authorization|raw stderr)/i);
    }
    expect(readFileSync('scripts/hdr-fixture-matrix.mjs', 'utf8')).toContain('sdr-fallback');
    expect(readFileSync('scripts/verify-hdr-container.mjs', 'utf8')).toContain('sdr-fallback');
  });

  it('does not track or allow fixture media as application content', () => {
    expect(execFileSync('git', ['ls-files', 'tests/resources/hdr'], { encoding: 'utf8' })).toBe('');
    expect(readFileSync('.gitignore', 'utf8')).toContain('tests/resources/hdr/');
    expect(readFileSync('.dockerignore', 'utf8')).toContain('tests/resources/hdr/');
    for (const script of ['scripts/hdr-fixture-matrix.mjs', 'scripts/verify-hdr-container.mjs']) expect(readFileSync(script, 'utf8')).toContain('physicalHdrValidation');
  });

  it('uses the production compositor and records explicit output signals', () => {
    const source = readFileSync('scripts/verify-hdr-container.mjs', 'utf8');
    expect(source).toContain("['build', '--tag'");
    expect(source).toContain('hdr-gainmap-compositor');
    expect(source).toContain('ffprobe');
    expect(source).toContain(':ro');
    expect(source).toContain('credentialsLogged: false');
  });
});

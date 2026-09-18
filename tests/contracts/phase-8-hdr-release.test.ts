import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const evidenceText = readFileSync('docs/phase-8-gate-c-hdr-evidence.md', 'utf8');
const evidence = readEvidence();
const scripts = ['scripts/verify-hdr-container.mjs', 'scripts/hdr-fixture-matrix.mjs'];

describe('Phase 8 Gate C release evidence contract', () => {
  it('contains redacted container, source/output, pixel, timing, and fallback fields', () => {
    expect(evidence.schema).toBe(2);
    expect(['PENDING', 'PASS', 'FAIL']).toContain(evidence.overallStatus);
    expect(['SDR-only', 'HDR-capable']).toContain(evidence.releaseMode);
    expect(evidence).toHaveProperty('container.toolVersions');
    expect(evidence).toHaveProperty('container.imageDigest');
    expect(Array.isArray(evidence.fixtures)).toBe(true);
    expect(Array.isArray(evidence.negativeCases)).toBe(true);
    expect(evidence.negativeCases.every((entry: any) => entry.outcome === 'sdr-fallback')).toBe(true);
    expect(evidence.redaction).toEqual({ credentialsLogged: false, rawMediaLogged: false, rawUpstreamBodiesLogged: false });
    for (const fixture of evidence.fixtures) {
      expect(fixture.sourceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(fixture.sourceBytes).toBeGreaterThan(0);
      expect(fixture.durationMs).toBeGreaterThanOrEqual(0);
      expect(fixture.output ?? fixture.fallback).toBeTruthy();
      if (fixture.output) expect(fixture.output).toHaveProperty('decodedPixelAssertions.nonBlank');
    }
  });

  it('requires all negative cases and physical HDR plus forced-SDR rows before PASS', () => {
    expect(new Set(evidence.negativeCases.map((entry: any) => entry.id))).toEqual(new Set([
      'missing-gain-map', 'missing-version', 'malformed-makernote', 'unsupported-profile', 'oversized-input', 'timeout', 'ffmpeg-failure'
    ]));
    const rows = evidence.physicalReview?.rows ?? [];
    if (evidence.overallStatus === 'PASS') {
      expect(evidence.releaseMode).toBe('HDR-capable');
      expect(evidence.physicalReview.status).toBe('PASS');
      expect(rows.length).toBeGreaterThanOrEqual(3);
      expect(rows.every((row: any) => row.hdrObservation === 'PASS' && row.forcedSdrObservation === 'PASS' && row.approval === 'PASS')).toBe(true);
    } else {
      expect(evidence.releaseMode).toBe('SDR-only');
    }
  });

  it('keeps the evidence path textual and does not permit tracked media or secret-bearing output', () => {
    expect(evidenceText).toContain('PENDING');
    for (const script of scripts) {
      const source = readFileSync(script, 'utf8');
      expect(source).not.toMatch(/console\.log\([^\n]*(?:password|cookie|authorization|raw stderr|raw media)/i);
      expect(source).toContain('sdr-fallback');
    }
    expect(evidenceText).not.toMatch(/(?:BEGIN (?:BASE64|JPEG|PNG)|data:(?:image|video)\/(?:base64|utf8))/i);
  });
});

function readEvidence(): any {
  const text = evidenceText;
  const match = text.match(/```json\n([\s\S]*?)\n```/);
  if (!match) throw new Error('Gate C evidence JSON block is missing');
  return JSON.parse(match[1]);
}

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const coverage = readFileSync(resolve(import.meta.dirname, '../../.planning/phases/08-production-build/COVERAGE.md'), 'utf8');

describe('Phase 8 API coverage gate contract', () => {
  it('retains every API row and explicit opt-out boundary', () => {
    for (const id of ['API-01', 'API-02', 'API-03', 'API-04', 'API-05', 'API-06']) {
      expect(coverage).toContain(`| ${id} |`);
    }
    expect(coverage).toContain('`/original`');
    expect(coverage).toContain('`/download`');
    expect(coverage).toContain('owner/API-key fallback');
  });

  it('requires signed Gate A PASS before Gate B', () => {
    expect(coverage).toContain('docs/phase-8-gate-a-checklist.md');
    expect(coverage).toContain('overall_status: PASS');
    expect(coverage).toContain('approval: APPROVED');
    expect(coverage).toContain('Gate B MUST NOT begin');
  });
});

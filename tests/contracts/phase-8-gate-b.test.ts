import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const matrix = readFileSync(resolve(import.meta.dirname, '../../docs/phase-8-gate-b-matrix.md'), 'utf8');

describe('Phase 8 Gate B evidence contract', () => {
	it('records every required promotion and fallback dimension', () => {
		for (const id of ['GB-01', 'GB-02', 'GB-03', 'GB-04', 'GB-05', 'GB-06', 'GB-07', 'GB-08']) {
			expect(matrix).toContain(`scenario_id: ${id}`);
		}
		for (const field of ['command:', 'expected:', 'observed:', 'status:', 'browser:', 'request_path_evidence:', 'fallback_evidence:']) {
			expect(matrix).toContain(field);
		}
	});

	it('requires explicit approval and blocks Gate C until PASS', () => {
		expect(matrix).toContain('overall_status: PENDING');
		expect(matrix).toContain('approval: PENDING');
		expect(matrix).toContain('PENDING or FAIL blocks Gate C');
		expect(matrix).toContain('HDR cannot begin unless Gate B is PASS');
	});
});

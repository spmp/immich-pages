import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const matrix = readFileSync(resolve(import.meta.dirname, '../../docs/phase-8-gate-b-matrix.md'), 'utf8');

describe('Phase 8 Gate B evidence contract', () => {
	it('records every required promotion and fallback dimension', () => {
		for (const id of ['GB-01', 'GB-02', 'GB-03', 'GB-04', 'GB-05', 'GB-06', 'GB-07', 'GB-08']) {
			expect(matrix).toContain(`- \`scenario_id\`: ${id}`);
		}
		for (const field of ['command', 'expected', 'observed', 'status', 'browser', 'request_path_evidence', 'fallback_evidence']) {
			expect(matrix).toContain(`- \`${field}\`:`);
		}
	});

	it('requires explicit approval and blocks Gate C until PASS', () => {
		const overallStatus = matrix.match(/- `overall_status`: (PENDING|PASS|FAIL)/)?.[1];
		const approval = matrix.match(/- `approval`: (PENDING|APPROVED)/)?.[1];
		expect(overallStatus).toBeDefined();
		expect(approval).toBeDefined();
		if (overallStatus === 'PASS') {
			// A PASS claim is only meaningful alongside a recorded human approver and date.
			expect(approval).toBe('APPROVED');
			expect(matrix).toMatch(/- `approver`: \S+/);
			expect(matrix).toMatch(/- `approved_date`: \d{4}-\d{2}-\d{2}/);
		} else {
			expect(approval).toBe('PENDING');
		}
		expect(matrix).toContain('PENDING or FAIL blocks Gate C');
		expect(matrix).toMatch(/HDR cannot\s+begin unless Gate B is PASS/);
	});
});

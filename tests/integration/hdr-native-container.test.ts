import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const evidenceDir = process.env.HDR_NATIVE_EVIDENCE_DIR ?? '/tmp/immich-pages-hdr-native';

describe('production HDR container evidence', () => {
	it('records explicit output identity without claiming physical HDR validation', () => {
		if (!existsSync(`${evidenceDir}/manifest.json`)) return;
		const manifest = JSON.parse(readFileSync(`${evidenceDir}/manifest.json`, 'utf8')) as Record<string, unknown>;
		expect(manifest).toMatchObject({ physicalHdrValidation: 'not-run', metadata: { auxiliaryTypeCheckedByNative: true } });
		expect(manifest.outputBytes).toBeGreaterThan(0);
		expect(manifest.outputHash).toMatch(/^[a-f0-9]{64}$/);
	});
});

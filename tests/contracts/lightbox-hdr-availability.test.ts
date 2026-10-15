import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lightbox = readFileSync('src/lib/components/journal/Lightbox.svelte', 'utf8');

/**
 * Production (2026-10-15): photos with no HDR data were still offered an HDR version, which the
 * server then refused, so viewers saw the zoom button stuck yellow and, with debugging on,
 * "failed". A photo with no HDR data must just be the standard photo. The probe helper itself is
 * executed in tests/unit/hdr-upgrade.test.ts; this pins the lightbox wiring, in this repo's
 * source-contract style for the lightbox.
 */
describe('lightbox HDR availability', () => {
	it('asks whether a photo has an HDR version before trying one, on both HDR paths', () => {
		// Both paths go through one remembered check per photo, built on probeHdrVersion.
		expect(lightbox).toContain('probeHdrVersion(src)');
		expect(lightbox.match(/checkHdrAvailability\(content\.data\.src\)/g)?.length).toBe(2);
		expect(lightbox).toContain("=== 'none'");
	});

	it('shows a photo with no HDR version as an ordinary photo: no tint, no failure reported', () => {
		expect(lightbox).toContain('content.__hdrNone');
		expect(lightbox).toMatch(/isHdrCandidate = [^;]*!content\?\.__hdrNone/);
	});

	it('drops the "loading" tint when an HDR attempt gives up, instead of staying yellow', () => {
		expect(lightbox).toContain('content.__hdrGaveUp = true');
		expect(lightbox).toMatch(/isHdrCandidate = [^;]*!content\?\.__hdrGaveUp/);
	});
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeImageDecode, supportsHdrDisplay, supportsWideColorGamut } from '../../src/lib/media/capabilities';

afterEach(() => vi.unstubAllGlobals());

describe('progressive media capability hints', () => {
	it('checks HDR and wide-gamut media queries without requiring them', () => {
		vi.stubGlobal('window', { matchMedia: vi.fn((query: string) => ({ matches: query === '(dynamic-range: high)' || query === '(color-gamut: p3)' })) });
		expect(supportsHdrDisplay()).toBe(true);
		expect(supportsWideColorGamut()).toBe(true);
	});

	it('probes only same-origin image URLs and reports decode failures', async () => {
		class FakeImage { onload?: () => void; onerror?: () => void; set src(value: string) { if (value === '/ok.avif') this.onload?.(); else this.onerror?.(); } }
		vi.stubGlobal('Image', FakeImage);
		expect(await probeImageDecode('/ok.avif')).toBe(true);
		expect(await probeImageDecode('/bad.webp')).toBe(false);
		expect(await probeImageDecode('https://immich.example/private')).toBe(false);
		expect(await probeImageDecode('//immich.example/private')).toBe(false);
	});

	it('times out a decoder that never settles', async () => {
		class HangingImage { onload?: () => void; onerror?: () => void; set src(_value: string) {} }
		vi.stubGlobal('Image', HangingImage);
		await expect(probeImageDecode('/never.avif', 1)).resolves.toBe(false);
	});

	// The HDR release-gate evidence contract itself (structured PENDING/PASS/FAIL, physical-row,
	// and redaction invariants) is covered by tests/contracts/phase-8-hdr-release.test.ts, which
	// parses the doc's machine-readable JSON block rather than grepping prose that reformats.
});

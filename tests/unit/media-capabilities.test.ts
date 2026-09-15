import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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

	it('has a physical-evidence record that keeps the HDR claim gated', () => {
		const evidence = readFileSync('docs/phase-8-gate-c-hdr-evidence.md', 'utf8');
		expect(evidence).toContain('overall_status: PENDING');
		expect(evidence).toContain('physical HDR-capable device');
		expect(evidence).toContain('emulation');
		expect(evidence).toContain('SDR fallback');
	});
});

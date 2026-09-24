import { beforeEach, describe, expect, it, vi } from 'vitest';
import { composeSampledGradient, composeThemeGradient, normalizeGradient, sampleHeroGradient } from '$lib/theme/gradient';

describe('theme gradient composition', () => {
	it('uses only the fixed direction and stop recipe', () => {
		expect(composeThemeGradient({ direction: '135deg', top: '#102030', bottom: '#405060' })).toBe('linear-gradient(135deg, #102030 0%, #405060 100%)');
		expect(composeSampledGradient('#000008', '#f8f8f8')).toEqual({ direction: 'to bottom', top: '#000008', bottom: '#f8f8f8' });
	});

	it('normalizes only bounded gradient values', () => {
		expect(normalizeGradient({ direction: 'to bottom', top: '#ABCDEF', bottom: '#123456' })).toEqual({ auto: false, direction: 'to bottom', top: '#abcdef', bottom: '#123456' });
		expect(normalizeGradient({ auto: true })).toEqual({ auto: true, direction: 'to bottom' });
		expect(normalizeGradient({ auto: true, direction: '135deg' })).toEqual({ auto: true, direction: '135deg' });
		expect(normalizeGradient({ auto: true, top: '#abcdef' })).toBeNull();
		expect(normalizeGradient({ direction: 'to right', top: '#abcdef', bottom: '#123456' })).toBeNull();
		expect(normalizeGradient({ direction: 'to bottom', top: 'url(evil)', bottom: '#123456' })).toBeNull();
		expect(normalizeGradient({ direction: 'to bottom', top: '#abcdef', bottom: '#123456', extra: 'ignored' })).toBeNull();
	});
});

describe('bounded hero sampler', () => {
	let reads: Array<[number, number]>;

	beforeEach(() => {
		reads = [];
		vi.stubGlobal('window', {});
		vi.stubGlobal('Image', class {
			naturalWidth = 64;
			naturalHeight = 32;
			decoding = '';
			src = '';
			decode = vi.fn(async () => undefined);
		});
		vi.stubGlobal('document', {
			createElement: vi.fn(() => ({
				width: 0,
				height: 0,
				getContext: () => ({
					drawImage: vi.fn(),
					getImageData: (x: number, y: number) => {
						reads.push([x, y]);
						const values: Record<string, [number, number, number]> = {
							'8,8': [1, 2, 3], '24,8': [9, 10, 11], '16,16': [17, 18, 19],
							'8,24': [249, 250, 251], '24,24': [241, 242, 243]
						};
						return { data: [...(values[`${x},${y}`] ?? [0, 0, 0]), 255] };
					}
				})
			}))
		});
	});

	it('samples exactly five points, reuses the center, and quantizes channels independently', async () => {
		const gradient = await sampleHeroGradient('/share/key/ref/media/hero/thumbnail?key=ref');
		expect(reads).toEqual([[8, 8], [24, 8], [16, 16], [8, 24], [24, 24]]);
		expect(gradient).toEqual({ direction: 'to bottom', top: '#080808', bottom: '#a8a8a8' });
	});

	it('keeps sampled stops readable against the selected theme text and distinct', async () => {
		const gradient = await sampleHeroGradient('/share/key/ref/media/hero/thumbnail?key=ref', '#f1eee7');
		expect(gradient?.top).not.toBe(gradient?.bottom);
		expect(gradient?.top).toMatch(/^#[0-9a-f]{6}$/);
		expect(gradient?.bottom).toMatch(/^#[0-9a-f]{6}$/);
	});

	it.each([
		['https://evil.example/hero.jpg', 'unsafe source'],
		['//evil.example/hero.jpg', 'protocol-relative source'],
		['/hero.jpg', 'missing decode dimensions']
	])('fails closed for %s (%s)', async (source) => {
		if (source === '/hero.jpg') vi.stubGlobal('Image', class { naturalWidth = Number.NaN; naturalHeight = 32; decode = async () => undefined; });
		expect(await sampleHeroGradient(source)).toBeNull();
	});

	it('fails closed when canvas creation or decoding fails', async () => {
		vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
		expect(await sampleHeroGradient('/hero.jpg')).toBeNull();
		vi.stubGlobal('Image', class { naturalWidth = 32; naturalHeight = 32; decode = async () => { throw new Error('decode'); }; });
		expect(await sampleHeroGradient('/hero.jpg')).toBeNull();
	});
});

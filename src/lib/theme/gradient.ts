import type { ThemeGradient } from './registry';
export { composeThemeGradient } from './registry';

export const GRADIENT_DIRECTIONS = ['to bottom', '135deg'] as const;
export const GRADIENT_SAMPLE_SIZE = 32;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SAMPLE_POINTS = [
	[0.25, 0.25],
	[0.75, 0.25],
	[0.5, 0.5],
	[0.25, 0.75],
	[0.75, 0.75]
] as const;

type Rgb = readonly [number, number, number];

export function normalizeGradient(value: unknown): ThemeGradient | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Record<string, unknown>;
	if (Object.keys(candidate).some((key) => !['direction', 'top', 'bottom'].includes(key))) return null;
	if ((candidate.direction !== 'to bottom' && candidate.direction !== '135deg') || typeof candidate.top !== 'string' || typeof candidate.bottom !== 'string' || !HEX_COLOR.test(candidate.top) || !HEX_COLOR.test(candidate.bottom)) return null;
	return { direction: candidate.direction, top: candidate.top.toLowerCase(), bottom: candidate.bottom.toLowerCase() };
}

export function composeSampledGradient(top: string, bottom: string): ThemeGradient {
	return { direction: 'to bottom', top, bottom };
}

export function quantizeChannel(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value / 8) * 8));
}

export function rgbToHex([red, green, blue]: Rgb): string {
	return `#${[red, green, blue].map((channel) => quantizeChannel(channel).toString(16).padStart(2, '0')).join('')}`;
}

function average(points: Rgb[]): Rgb {
	return [
		points.reduce((sum, point) => sum + point[0], 0) / points.length,
		points.reduce((sum, point) => sum + point[1], 0) / points.length,
		points.reduce((sum, point) => sum + point[2], 0) / points.length
	];
}

function safeSampleSource(source: string): boolean {
	return source.startsWith('/') && !source.startsWith('//');
}

/** Sample only an already-authorized Pages-host representation in the browser. */
export async function sampleHeroGradient(source: string): Promise<ThemeGradient | null> {
	if (typeof window === 'undefined' || typeof Image === 'undefined' || !safeSampleSource(source)) return null;

	try {
		const image = new Image();
		image.decoding = 'async';
		image.src = source;
		if (typeof image.decode === 'function') await image.decode();
		else await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('hero-decode-failed'));
		});
		const width = image.naturalWidth;
		const height = image.naturalHeight;
		if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
		const canvas = document.createElement('canvas');
		canvas.width = GRADIENT_SAMPLE_SIZE;
		canvas.height = GRADIENT_SAMPLE_SIZE;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) return null;
		const scale = Math.max(GRADIENT_SAMPLE_SIZE / width, GRADIENT_SAMPLE_SIZE / height);
		const cropWidth = GRADIENT_SAMPLE_SIZE / scale;
		const cropHeight = GRADIENT_SAMPLE_SIZE / scale;
		context.drawImage(image, (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, GRADIENT_SAMPLE_SIZE, GRADIENT_SAMPLE_SIZE);
		const pixels = SAMPLE_POINTS.map(([x, y]) => {
			const pixel = context.getImageData(Math.min(31, Math.floor(x * GRADIENT_SAMPLE_SIZE)), Math.min(31, Math.floor(y * GRADIENT_SAMPLE_SIZE)), 1, 1).data;
			return [pixel[0], pixel[1], pixel[2]] as Rgb;
		});
		const center = pixels[2];
		return composeSampledGradient(rgbToHex(average([pixels[0], pixels[1], center])), rgbToHex(average([pixels[3], pixels[4], center])));
	} catch {
		return null;
	}
}

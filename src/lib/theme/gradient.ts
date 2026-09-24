import type { ThemeGradient } from './registry';
import type { NormalizedGradient } from '$server/presentation/model';
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

function hexToRgb(value: string): Rgb {
	return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
}

function relativeLuminance([red, green, blue]: Rgb): number {
	const linear = (channel: number) => {
		const value = channel / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function contrastRatio(first: Rgb, second: Rgb): number {
	const firstLuminance = relativeLuminance(first);
	const secondLuminance = relativeLuminance(second);
	const lighter = Math.max(firstLuminance, secondLuminance);
	const darker = Math.min(firstLuminance, secondLuminance);
	return (lighter + 0.05) / (darker + 0.05);
}

function blend(first: Rgb, second: Rgb, amount: number): Rgb {
	return first.map((channel, index) => channel + (second[index] - channel) * amount) as unknown as Rgb;
}

function toHex(rgb: Rgb): string {
	return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function ensureTextContrast(value: string, foreground: string): string {
	const color = hexToRgb(value);
	const text = hexToRgb(foreground);
	if (contrastRatio(color, text) >= 4.5) return value;
	const target = relativeLuminance(text) > 0.5 ? ([0, 0, 0] as Rgb) : ([255, 255, 255] as Rgb);
	for (let amount = 0.08; amount <= 1; amount += 0.08) {
		const adjusted = blend(color, target, amount);
		if (contrastRatio(adjusted, text) >= 4.5) return toHex(adjusted);
	}
	return toHex(target);
}

function paletteColor(palette: Record<string, { hex?: string } | null | undefined>): string | undefined {
	for (const name of ['Vibrant', 'DarkVibrant', 'LightVibrant', 'DarkMuted', 'LightMuted', 'Muted']) {
		const color = palette[name]?.hex;
		if (color && HEX_COLOR.test(color)) return color.toLowerCase();
	}
}

export function normalizeGradient(value: unknown): NormalizedGradient | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Record<string, unknown>;
	if (Object.keys(candidate).some((key) => !['auto', 'direction', 'top', 'bottom'].includes(key))) return null;
	const auto = candidate.auto === true;
	if (candidate.auto !== undefined && typeof candidate.auto !== 'boolean') return null;
	const direction = candidate.direction === undefined ? 'to bottom' : candidate.direction;
	if (direction !== 'to bottom' && direction !== '135deg') return null;
	if (auto) return candidate.top === undefined && candidate.bottom === undefined ? { auto: true, direction } : null;
	if (typeof candidate.top !== 'string' || typeof candidate.bottom !== 'string' || !HEX_COLOR.test(candidate.top) || !HEX_COLOR.test(candidate.bottom)) return null;
	return { auto: false, direction, top: candidate.top.toLowerCase(), bottom: candidate.bottom.toLowerCase() };
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
export async function sampleHeroGradient(source: string, foreground?: string): Promise<ThemeGradient | null> {
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
		let top = rgbToHex(average([pixels[0], pixels[1], center]));
		let bottom = rgbToHex(average([pixels[3], pixels[4], center]));
		try {
			const { Vibrant } = await import('node-vibrant/browser');
			const region = (startY: number) => {
				const canvas = document.createElement('canvas');
				canvas.width = GRADIENT_SAMPLE_SIZE;
				canvas.height = GRADIENT_SAMPLE_SIZE / 2;
				const regionContext = canvas.getContext('2d', { willReadFrequently: true });
				if (!regionContext) return null;
				regionContext.drawImage(image, (width - cropWidth) / 2, startY, cropWidth, cropHeight / 2, 0, 0, GRADIENT_SAMPLE_SIZE, GRADIENT_SAMPLE_SIZE / 2);
				return canvas;
			};
			const topCanvas = region((height - cropHeight) / 2);
			const bottomCanvas = region((height - cropHeight) / 2 + cropHeight / 2);
			if (topCanvas && bottomCanvas) {
				const [topPalette, bottomPalette] = await Promise.all([
					Vibrant.from(topCanvas as unknown as HTMLImageElement).getPalette(),
					Vibrant.from(bottomCanvas as unknown as HTMLImageElement).getPalette()
				]);
				top = paletteColor(topPalette) ?? top;
				bottom = paletteColor(bottomPalette) ?? bottom;
			}
		} catch {
			// The bounded regional average remains the safe fallback if extraction fails.
		}
		const safeTop = foreground ? ensureTextContrast(top, foreground) : top;
		let safeBottom = foreground ? ensureTextContrast(bottom, foreground) : bottom;
		if (foreground && safeTop === safeBottom) {
			const target = relativeLuminance(hexToRgb(foreground)) > 0.5 ? '#ffffff' : '#000000';
			safeBottom = toHex(blend(hexToRgb(safeBottom), hexToRgb(target), 0.12));
		}
		return composeSampledGradient(safeTop, safeBottom);
	} catch {
		return null;
	}
}

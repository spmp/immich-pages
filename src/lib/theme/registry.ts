/** The only values that may reach the temporary theme presentation boundary. */
export const THEME_KEYS = [
	'studio-modern',
	'studio',
	'minimal',
	'editorial',
	'classic',
	'noir',
	'monograph'
] as const;

export type ThemeKey = (typeof THEME_KEYS)[number];

/** Studio Modern is the neutral, image-led baseline emitted by SSR. */
export const BASELINE_THEME_KEY: ThemeKey = 'studio-modern';
export const THEME_STORAGE_KEY = 'immich-pages:theme';

export type ThemeTokens = {
	background: string;
	surface: string;
	text: string;
	muted: string;
	accent: string;
	rule: string;
	radius: string;
	contentWidth: string;
	sectionSpace: string;
	fontHeading: string;
	fontBody: string;
	fontCaption: string;
};

export type ThemeProfile = {
	label: string;
	description: string;
	tokens: ThemeTokens;
};

const systemSans = 'ui-sans-serif, system-ui, sans-serif';
const systemSerif = 'ui-serif, Georgia, serif';

/** Fixed profiles are metadata for the explorer; values never come from storage. */
export const THEME_REGISTRY: Readonly<Record<ThemeKey, ThemeProfile>> = {
	'studio-modern': {
		label: 'Studio Modern',
		description: 'Precision, hairlines, and a signal accent.',
		tokens: { background: '#f6f3ee', surface: '#fffdf9', text: '#202522', muted: '#66706b', accent: '#bd4d2e', rule: '#d9d4ca', radius: '0.25rem', contentWidth: '80rem', sectionSpace: 'clamp(3rem, 8vw, 7rem)', fontHeading: systemSans, fontBody: systemSans, fontCaption: systemSans }
	},
	studio: {
		label: 'Studio',
		description: 'An editorial serif and sans pairing with a soft frame.',
		tokens: { background: '#e9e2d7', surface: '#faf7f0', text: '#302b25', muted: '#756b5f', accent: '#8d4f38', rule: '#cfc2b1', radius: '0.5rem', contentWidth: '78rem', sectionSpace: 'clamp(3.5rem, 9vw, 8rem)', fontHeading: systemSerif, fontBody: systemSans, fontCaption: systemSans }
	},
	minimal: {
		label: 'Minimal',
		description: 'High contrast, full-bleed imagery, and tight rhythm.',
		tokens: { background: '#ffffff', surface: '#ffffff', text: '#111111', muted: '#555555', accent: '#111111', rule: '#dddddd', radius: '0rem', contentWidth: '90rem', sectionSpace: 'clamp(2rem, 5vw, 5rem)', fontHeading: systemSans, fontBody: systemSans, fontCaption: systemSans }
	},
	editorial: {
		label: 'Editorial',
		description: 'Warm cinematic spacing and a magazine-like hierarchy.',
		tokens: { background: '#f1eadf', surface: '#fbf7f0', text: '#332b26', muted: '#77695f', accent: '#a24b36', rule: '#d8c9b9', radius: '0.125rem', contentWidth: '74rem', sectionSpace: 'clamp(4rem, 10vw, 9rem)', fontHeading: systemSerif, fontBody: systemSerif, fontCaption: systemSans }
	},
	classic: {
		label: 'Classic',
		description: 'Warm luxury, framed images, and a restrained gold accent.',
		tokens: { background: '#f4f0e7', surface: '#fffdf7', text: '#302d27', muted: '#746c5d', accent: '#a37a36', rule: '#d8cdb8', radius: '0.75rem', contentWidth: '76rem', sectionSpace: 'clamp(3.5rem, 8vw, 7rem)', fontHeading: systemSerif, fontBody: systemSerif, fontCaption: systemSans }
	},
	noir: {
		label: 'Noir',
		description: 'A darkroom palette with an amber signal.',
		tokens: { background: '#161616', surface: '#222222', text: '#f1eee7', muted: '#aaa59b', accent: '#d89a4a', rule: '#46433e', radius: '0.125rem', contentWidth: '80rem', sectionSpace: 'clamp(3rem, 8vw, 7rem)', fontHeading: systemSans, fontBody: systemSans, fontCaption: systemSans }
	},
	monograph: {
		label: 'Monograph',
		description: 'Type-first book rhythm with generous whitespace.',
		tokens: { background: '#fafafa', surface: '#ffffff', text: '#1b1b1b', muted: '#676767', accent: '#8b3027', rule: '#cfcfcf', radius: '0rem', contentWidth: '68rem', sectionSpace: 'clamp(4rem, 12vw, 10rem)', fontHeading: systemSerif, fontBody: systemSerif, fontCaption: systemSans }
	}
};

export function normalizeThemeKey(value: unknown): ThemeKey {
	return typeof value === 'string' && Object.prototype.hasOwnProperty.call(THEME_REGISTRY, value)
		? value as ThemeKey
		: BASELINE_THEME_KEY;
}

export function resetThemeKey(): ThemeKey {
	return BASELINE_THEME_KEY;
}

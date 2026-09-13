/** The only values that may reach the production theme presentation boundary. */
export const THEME_KEYS = ['default', 'light', 'dark'] as const;

export type ThemeKey = (typeof THEME_KEYS)[number];

/** Default is the OS-aware choice; dark is the deterministic SSR baseline. */
export const BASELINE_THEME_KEY: ThemeKey = 'default';
export const SSR_THEME_KEY: ThemeKey = 'dark';
export const THEME_STORAGE_KEY = 'immich-pages:theme';

export type ThemeGradient = Readonly<{ direction: 'to bottom' | '135deg'; top: string; bottom: string }>;

export function composeThemeGradient({ direction, top, bottom }: ThemeGradient): string {
	return `linear-gradient(${direction}, ${top} 0%, ${bottom} 100%)`;
}

export type ThemeTokens = {
	background: string;
	/** Fixed, allowlisted gradient recipe. Values are never authored CSS. */
	gradient?: ThemeGradient;
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
const lightGradient: ThemeGradient = { direction: 'to bottom', top: '#fafafa', bottom: '#fafafa' };
const darkGradient: ThemeGradient = { direction: 'to bottom', top: '#161616', bottom: '#161616' };

/** Fixed profiles are metadata for the selector; values never come from storage. */
export const THEME_REGISTRY: Readonly<Record<string, ThemeProfile>> = {
	default: {
		label: 'Default', description: 'Follows your operating system light or dark preference.',
		tokens: { background: composeThemeGradient(darkGradient), gradient: darkGradient, surface: '#222222', text: '#f1eee7', muted: '#aaa59b', accent: '#d89a4a', rule: '#46433e', radius: '0rem', contentWidth: '68rem', sectionSpace: 'clamp(4rem, 12vw, 10rem)', fontHeading: systemSerif, fontBody: systemSerif, fontCaption: systemSans }
	},
	light: {
		label: 'Light', description: 'Monochrome Reference light mode.',
		tokens: { background: composeThemeGradient(lightGradient), gradient: lightGradient, surface: '#ffffff', text: '#1b1b1b', muted: '#676767', accent: '#8b3027', rule: '#cfcfcf', radius: '0rem', contentWidth: '68rem', sectionSpace: 'clamp(4rem, 12vw, 10rem)', fontHeading: systemSerif, fontBody: systemSerif, fontCaption: systemSans }
	},
	dark: {
		label: 'Dark', description: 'Noir dark mode.',
		tokens: { background: composeThemeGradient(darkGradient), gradient: darkGradient, surface: '#222222', text: '#f1eee7', muted: '#aaa59b', accent: '#d89a4a', rule: '#46433e', radius: '0rem', contentWidth: '68rem', sectionSpace: 'clamp(4rem, 12vw, 10rem)', fontHeading: systemSerif, fontBody: systemSerif, fontCaption: systemSans }
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

export function resolveThemeKey(selection: ThemeKey | string, prefersDark: boolean): ThemeKey {
	const normalized = normalizeThemeKey(selection);
	return normalized === BASELINE_THEME_KEY ? (prefersDark ? 'dark' : 'light') : normalized;
}

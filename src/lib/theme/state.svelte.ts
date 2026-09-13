import { BASELINE_THEME_KEY, normalizeThemeKey, resetThemeKey, resolveThemeKey, SSR_THEME_KEY, THEME_STORAGE_KEY, type ThemeKey } from './registry';

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): ThemeStorage | undefined {
	if (typeof window === 'undefined') return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

export function readStoredThemeKey(): ThemeKey {
	try {
		return normalizeThemeKey(storage()?.getItem(THEME_STORAGE_KEY));
	} catch {
		return BASELINE_THEME_KEY;
	}
}

export function createThemeState() {
	let selectedKey = $state<ThemeKey>(BASELINE_THEME_KEY);
	let prefersDark = $state(false);
	let effectiveKey = $state<ThemeKey>(SSR_THEME_KEY);
	let hydrated = false;
	let mediaQuery: MediaQueryList | undefined;

	function persist(key: ThemeKey) {
		try {
			storage()?.setItem(THEME_STORAGE_KEY, key);
		} catch {
			// Private browsing and blocked storage are valid; memory remains the fallback.
		}
	}

	return {
		get selectedKey() {
			return selectedKey;
		},
		get effectiveKey() {
			return effectiveKey;
		},
		hydrate() {
			if (hydrated || typeof window === 'undefined') return;
			hydrated = true;
			selectedKey = readStoredThemeKey();
			persist(selectedKey);
			mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
			prefersDark = mediaQuery.matches;
			effectiveKey = resolveThemeKey(selectedKey, prefersDark);
			mediaQuery.addEventListener('change', (event) => {
				prefersDark = event.matches;
				effectiveKey = resolveThemeKey(selectedKey, prefersDark);
			});
		},
		select(value: unknown) {
			selectedKey = normalizeThemeKey(value);
			effectiveKey = resolveThemeKey(selectedKey, prefersDark);
			if (hydrated) persist(selectedKey);
		},
		reset() {
			selectedKey = resetThemeKey();
			effectiveKey = selectedKey;
			if (!hydrated) return;
			try {
				storage()?.removeItem(THEME_STORAGE_KEY);
			} catch {
				// Reset still succeeds in memory when storage is unavailable.
			}
		}
	};
}

export type ThemeState = ReturnType<typeof createThemeState>;

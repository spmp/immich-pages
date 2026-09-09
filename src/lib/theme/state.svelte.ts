import { BASELINE_THEME_KEY, normalizeThemeKey, resetThemeKey, THEME_STORAGE_KEY, type ThemeKey } from './registry';

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
	let hydrated = false;

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
		hydrate() {
			if (hydrated || typeof window === 'undefined') return;
			hydrated = true;
			selectedKey = readStoredThemeKey();
		},
		select(value: unknown) {
			selectedKey = normalizeThemeKey(value);
			if (hydrated) persist(selectedKey);
		},
		reset() {
			selectedKey = resetThemeKey();
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

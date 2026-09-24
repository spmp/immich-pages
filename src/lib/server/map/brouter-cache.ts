import type { MapRoute } from './types';

export const BROUTER_CACHE_MAX_ENTRIES = 256;
export const BROUTER_CACHE_TTL_MS = 60 * 60 * 1000;

type Entry = { route: MapRoute; expiresAt: number };

export class BrouterLruCache {
	private readonly entries = new Map<string, Entry>();

	get(key: string, now = Date.now()): MapRoute | undefined {
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt <= now) { this.entries.delete(key); return undefined; }
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.route;
	}

	set(key: string, route: MapRoute, now = Date.now()): void {
		this.entries.delete(key);
		this.entries.set(key, { route, expiresAt: now + BROUTER_CACHE_TTL_MS });
		while (this.entries.size > BROUTER_CACHE_MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value as string);
	}

	clear(): void { this.entries.clear(); }
}

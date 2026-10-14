import type { MapRoute } from './types';

export const BROUTER_CACHE_MAX_ENTRIES = 256;
export const BROUTER_CACHE_TTL_MS = 60 * 60 * 1000;

type Entry<Value> = { value: Value; expiresAt: number; weight: number };
type Options<Value> = { maxEntries?: number; maxWeight?: number; weigh?: (value: Value) => number };

/** In-memory only, like every cache in Pages: gone on restart, never a source of truth. */
export class BrouterLruCache<Value = MapRoute> {
	private readonly entries = new Map<string, Entry<Value>>();
	private readonly maxEntries: number;
	private readonly maxWeight: number;
	private readonly weigh: (value: Value) => number;
	private weight = 0;

	constructor(options: Options<Value> = {}) {
		this.maxEntries = options.maxEntries ?? BROUTER_CACHE_MAX_ENTRIES;
		this.maxWeight = options.maxWeight ?? Number.POSITIVE_INFINITY;
		this.weigh = options.weigh ?? (() => 0);
	}

	private remove(key: string): void {
		const entry = this.entries.get(key);
		if (!entry) return;
		this.entries.delete(key);
		this.weight -= entry.weight;
	}

	get(key: string, now = Date.now()): Value | undefined {
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt <= now) { this.remove(key); return undefined; }
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.value;
	}

	set(key: string, value: Value, now = Date.now(), ttlMs = BROUTER_CACHE_TTL_MS): void {
		this.remove(key);
		const weight = this.weigh(value);
		if (weight > this.maxWeight) return;
		this.entries.set(key, { value, expiresAt: now + ttlMs, weight });
		this.weight += weight;
		while (this.entries.size > this.maxEntries || this.weight > this.maxWeight) this.remove(this.entries.keys().next().value as string);
	}

	clear(): void { this.entries.clear(); this.weight = 0; }
}

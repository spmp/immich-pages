import type { HdrRepresentation } from './hdr-prewarm';
import { logHdrRegistryStaleness } from '$server/share/diagnostics';

// The unified per-asset identity/bookkeeping store that replaces the three independently-
// synchronized schemes (hdr-cache.ts's content-addressed byte Map, HdrPrewarmCoordinator's
// cache-key+scope+generation-keyed jobs Map, and the now-orphaned hdr-prewarm-source.ts's
// divergent id:mime:dimensions identity) diagnosed as CR-01/CR-02/CR-03 in
// .planning/debug/hdr-caching-uat-20261010.md and REVIEW.md. `scope` is the outer key on
// every method -- there is no optional/defaultable scope parameter anywhere in this module,
// which is the structural fix: the wrong thing (an unscoped lookup silently falling into a
// shared 'default' bucket) is not expressible, not just currently avoided by convention.

export type HdrRepresentationStatus = 'pending' | 'converting' | 'ready' | 'failed' | 'skipped';

export type HdrRegistryIdentity = {
	sourceIdentity: string;
	width?: number;
	height?: number;
};

export type HdrRegistryEntry = {
	status: HdrRepresentationStatus;
	sourceIdentity: string;
	width?: number;
	height?: number;
	cacheKey?: string;
	attempts: number;
	error?: string;
	generation: number;
	abortController: AbortController;
	updatedAt: number;
};

type RepresentationSlots = Partial<Record<HdrRepresentation, HdrRegistryEntry>>;

// Mirrors buildHdrCacheKey's own safe() escaping (hdr-cache.ts) -- bounded, no path/control
// characters, so a malformed or oversized assetId/scope can never grow this registry's Map
// keys unboundedly or collide via escaping ambiguity.
function safePart(value: string): string {
	return value.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 160);
}

function identityMatches(entry: HdrRegistryEntry, identity: HdrRegistryIdentity): boolean {
	return entry.sourceIdentity === identity.sourceIdentity && entry.width === identity.width && entry.height === identity.height;
}

export class HdrAssetRegistry {
	private readonly scopes = new Map<string, Map<string, RepresentationSlots>>();
	private readonly generations = new Map<string, number>();

	generationFor(scope: string): number {
		return this.generations.get(scope) ?? 0;
	}

	private assetsFor(scope: string): Map<string, RepresentationSlots> {
		let assets = this.scopes.get(scope);
		if (!assets) {
			assets = new Map();
			this.scopes.set(scope, assets);
		}
		return assets;
	}

	/**
	 * Returns the existing entry for (scope, assetId, representation) if it is still current --
	 * same generation, same identity, not 'skipped' -- otherwise creates and stores a fresh
	 * 'pending' entry. Two independently-derived identities that happen to coincide is exactly
	 * the class of bug this method exists to make unnecessary: there is only ever one entry per
	 * (scope, assetId, representation), so a background writer and an interactive reader of the
	 * SAME asset always observe the SAME object.
	 */
	resolve(scope: string, assetId: string, representation: HdrRepresentation, identity: HdrRegistryIdentity): HdrRegistryEntry {
		const safeAssetId = safePart(assetId);
		const assets = this.assetsFor(scope);
		let slots = assets.get(safeAssetId);
		if (!slots) {
			slots = {};
			assets.set(safeAssetId, slots);
		}
		const existing = slots[representation];
		const currentGeneration = this.generationFor(scope);
		if (existing && existing.status !== 'skipped' && existing.generation >= currentGeneration && identityMatches(existing, identity)) {
			return existing;
		}
		if (existing) {
			const reason = existing.status === 'skipped' ? 'revoked' : existing.generation < currentGeneration ? 'generation' : 'identity';
			logHdrRegistryStaleness({ scope, assetId: safeAssetId, representation, reason });
		}
		const fresh: HdrRegistryEntry = {
			status: 'pending',
			sourceIdentity: identity.sourceIdentity,
			width: identity.width,
			height: identity.height,
			attempts: 0,
			generation: currentGeneration,
			abortController: new AbortController(),
			updatedAt: Date.now()
		};
		slots[representation] = fresh;
		return fresh;
	}

	/** Plain lookup, no mutation and no staleness check -- callers that only need to read status should use this, not resolve(). */
	read(scope: string, assetId: string, representation: HdrRepresentation): HdrRegistryEntry | undefined {
		return this.scopes.get(scope)?.get(safePart(assetId))?.[representation];
	}

	transition(entry: HdrRegistryEntry, next: Partial<Pick<HdrRegistryEntry, 'status' | 'cacheKey' | 'attempts' | 'error'>>): HdrRegistryEntry {
		Object.assign(entry, next);
		entry.updatedAt = Date.now();
		return entry;
	}

	/**
	 * The registry-owned cancellation handle CR-03 asks for: revoking a scope (share
	 * revocation, page reload with a new generation) aborts every still-in-flight entry's own
	 * AbortController and marks it 'skipped', so authorization-scoped work never outlives the
	 * scope that authorized it. Entries in other scopes are untouched.
	 */
	revokeScope(scope: string): void {
		this.generations.set(scope, this.generationFor(scope) + 1);
		const assets = this.scopes.get(scope);
		if (!assets) return;
		for (const slots of assets.values()) {
			for (const representation of Object.keys(slots) as HdrRepresentation[]) {
				const entry = slots[representation];
				if (entry && (entry.status === 'pending' || entry.status === 'converting')) {
					entry.abortController.abort();
					entry.status = 'skipped';
					entry.updatedAt = Date.now();
				}
			}
		}
	}
}

export function createHdrAssetRegistry(): HdrAssetRegistry {
	return new HdrAssetRegistry();
}

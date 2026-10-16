import { summarizeDirectShare } from '$server/page/assemble';
import { decodeRegistry, REGISTRY_MAX_ENTRIES } from '$server/share/registry';
import { sessionForShare } from '$server/share/session';
import { logVisitedShareRegistry } from '$server/share/diagnostics';
import type { SharedLinkRef } from '$server/share/ref';
import type { ImmichProvider } from '$server/immich/provider';
import type { KnownLibraryEntry, LibraryDiscoveryContext, LibraryResult } from './model';

// Everything the registry can hold, plus the share being viewed if it is not in it yet.
const MAX_CANDIDATES = REGISTRY_MAX_ENTRIES + 1;
// Every share is re-authorized against Immich on every discovery -- nothing here is cached, so a
// revoked share drops out of the list at once. A few lookups at a time keeps fifty of them to a
// fraction of a second without opening fifty connections to Immich per page view.
const LOOKUP_CONCURRENCY = 6;

type AlbumFacts = { title: string; thumbnailAssetId?: string; startDate?: string; endDate?: string; updatedAt?: string };

/** A library row for a share, from the album facts a page and a summary both carry. */
export function libraryEntry(ref: SharedLinkRef, album: AlbumFacts, hasThumbnail: boolean): KnownLibraryEntry {
	const href = `/share/${ref.kind}/${encodeURIComponent(ref.value)}`;
	return {
		ref,
		entry: {
			href, title: album.title,
			date: album.startDate && album.endDate ? { start: album.startDate, end: album.endDate } : undefined,
			thumbnail: hasThumbnail && album.thumbnailAssetId ? `${href}/media/${encodeURIComponent(album.thumbnailAssetId)}/thumbnail?${ref.kind}=${encodeURIComponent(ref.value)}` : undefined
		},
		sortDate: album.startDate ?? album.updatedAt ?? album.endDate ?? ''
	};
}

export async function discoverLibrary(provider: ImmichProvider, context: LibraryDiscoveryContext, now = Date.now()): Promise<LibraryResult> {
	const registered = decodeRegistry(context.registryCookie, now)?.entries ?? [];
	logVisitedShareRegistry({ phase: 'decode', result: registered.length ? 'success' : 'empty', entryCount: registered.length });
	const sameRef = (a: SharedLinkRef, b: SharedLinkRef) => a.kind === b.kind && a.value === b.value;
	// Most recently visited first, so if anything has to be left out it is the oldest.
	const candidates = [...(context.current ?? []), ...registered.map(({ kind, value }) => ({ kind, value } satisfies SharedLinkRef)).reverse()]
		.filter((ref, index, all) => all.findIndex((candidate) => sameRef(candidate, ref)) === index)
		.slice(0, MAX_CANDIDATES);
	const found: KnownLibraryEntry[] = [];
	let failures = 0;
	const lookup = async (shareRef: SharedLinkRef) => {
		// The share whose page this very request just assembled has already been authorized.
		const known = context.known?.find((candidate) => sameRef(candidate.ref, shareRef));
		if (known) { found.push(known); return; }
		try {
			const session = sessionForShare(context.sessionCookie, shareRef, now);
			const shareContext = { shareRef, cookie: session.token ? `immich_shared_link_token=${session.token}` : null, authorization: null };
			const outcome = await summarizeDirectShare(provider, shareContext, context.requestId);
			if (outcome.kind !== 'summary') { if (outcome.kind === 'upstream-error') failures++; return; }
			found.push(libraryEntry(shareRef, outcome.album, outcome.hasThumbnail));
		} catch { failures++; }
	};
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, candidates.length) }, async () => {
		while (next < candidates.length) { const index = next; next += 1; await lookup(candidates[index]); }
	}));
	found.sort((a, b) => b.sortDate.localeCompare(a.sortDate) || a.entry.title.localeCompare(b.entry.title, undefined, { sensitivity: 'base' }) || a.entry.href.localeCompare(b.entry.href));
	const clean = found.map(({ entry }) => entry);
	return { kind: clean.length ? 'ready' : failures ? 'temporary' : 'empty', entries: clean, warnings: failures ? ['some-pages-unavailable'] : [] };
}

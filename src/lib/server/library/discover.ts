import { assembleDirectShare } from '$server/page/assemble';
import { decodeRegistry } from '$server/share/registry';
import { sessionForShare } from '$server/share/session';
import { logVisitedShareRegistry } from '$server/share/diagnostics';
import type { SharedLinkRef } from '$server/share/ref';
import type { ImmichProvider } from '$server/immich/provider';
import type { LibraryDiscoveryContext, LibraryResult, NavigationEntry } from './model';

const MAX_CANDIDATES = 8;

export async function discoverLibrary(provider: ImmichProvider, context: LibraryDiscoveryContext, now = Date.now()): Promise<LibraryResult> {
	const registered = decodeRegistry(context.registryCookie, now)?.entries ?? [];
	logVisitedShareRegistry({ phase: 'decode', result: registered.length ? 'success' : 'empty', entryCount: registered.length });
	const candidates = [...registered.map(({ kind, value }) => ({ kind, value } satisfies SharedLinkRef)), ...(context.current ?? [])]
		.filter((ref, index, all) => all.findIndex((candidate) => candidate.kind === ref.kind && candidate.value === ref.value) === index)
		.slice(0, MAX_CANDIDATES);
	const entries: Array<NavigationEntry & { sortDate: string }> = [];
	let failures = 0;
	for (const shareRef of candidates) {
		try {
			const session = sessionForShare(context.sessionCookie, shareRef, now);
			const shareContext = { shareRef, cookie: session.token ? `immich_shared_link_token=${session.token}` : null, authorization: null };
			const outcome = await assembleDirectShare(provider, shareContext, context.requestId);
			if (outcome.kind !== 'page') { if (outcome.kind === 'upstream-error') failures++; continue; }
			const page = outcome.page;
			const href = `/share/${shareRef.kind}/${encodeURIComponent(shareRef.value)}`;
			const thumbnailAssetId = page.album.thumbnailAssetId;
			entries.push({ href, title: page.album.title, date: page.album.startDate && page.album.endDate ? { start: page.album.startDate, end: page.album.endDate } : undefined,
				thumbnail: thumbnailAssetId && page.assets.some((asset) => asset.id === thumbnailAssetId) ? `${href}/media/${encodeURIComponent(thumbnailAssetId)}/thumbnail?${shareRef.kind}=${encodeURIComponent(shareRef.value)}` : undefined,
				sortDate: page.album.startDate ?? page.album.updatedAt ?? page.album.endDate ?? '' });
		} catch { failures++; }
	}
	entries.sort((a, b) => b.sortDate.localeCompare(a.sortDate) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.href.localeCompare(b.href));
	const clean = entries.map(({ sortDate: _sortDate, ...entry }) => entry);
	return { kind: clean.length ? 'ready' : failures ? 'temporary' : 'empty', entries: clean, warnings: failures ? ['some-pages-unavailable'] : [] };
}

import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { authContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { assembleDirectShare } from '$server/page/assemble';
import { parseSharedLinkRef } from '$server/share/ref';
import { logDirectShareBoundary, logDirectShareOutcome, logVisitedShareRegistry } from '$server/share/diagnostics';
import { addSession, clearSessionCookie, extractImmichShareToken, PAGES_SESSION_COOKIE, sessionCookie, sessionForShare } from '$server/share/session';
import { registerShare, REGISTRY_TTL_MS, VISITED_SHARES_COOKIE } from '$server/share/registry';
import { discoverLibrary, libraryEntry } from '$server/library/discover';
import type { NavigationEntry } from '$server/library/model';
import { parseHdrIndicator } from '$server/media/hdr-prewarm-policy';

const safePassword = (value: FormDataEntryValue | null) => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;


export const load: PageServerLoad = async ({ params, request, locals, fetch, cookies, setHeaders }) => {
	setHeaders({ 'cache-control': 'private, no-store' });
	const pathname = new URL(request.url).pathname;
	logDirectShareBoundary({ phase: 'start', method: request.method, pathname });
	const ref = parseSharedLinkRef(params.kind, params.ref);
	if (!ref) {
		logDirectShareOutcome({ outcome: 'not-found', method: request.method, pathname });
		logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: 404 });
		error(404, 'Share not found');
	}
	const session = sessionForShare(cookies.get(PAGES_SESSION_COOKIE), ref);
	if (session.cookie) cookies.set(PAGES_SESSION_COOKIE, session.cookie.split(';')[0].split('=')[1] ?? '', { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: session.token ? 86400 : 0 });
	const visitorToken = session.token ?? extractImmichShareToken(request.headers.get('cookie'));
	const context = { ...authContextFromRequest(request, ref), cookie: visitorToken ? `immich_shared_link_token=${visitorToken}` : null };
	let outcome: Awaited<ReturnType<typeof assembleDirectShare>>;
	try {
		outcome = await assembleDirectShare(createImmichProvider(fetch), context, locals.requestId);
	} catch {
		outcome = { kind: 'upstream-error', requestId: locals.requestId };
	}
	logDirectShareOutcome({ outcome: outcome.kind, method: request.method, pathname,
		metadataReason: outcome.kind === 'invalid-metadata' ? outcome.metadataReason : undefined });
	if (outcome.kind === 'page') {
		const indicator = parseHdrIndicator(env.HDR_PREWARM_INDICATOR);
		const currentHref = `/share/${ref.kind}/${encodeURIComponent(ref.value)}`;
		const currentEntry: NavigationEntry = { href: currentHref, title: outcome.page.album.title,
			date: outcome.page.album.startDate && outcome.page.album.endDate ? { start: outcome.page.album.startDate, end: outcome.page.album.endDate } : undefined };
		let navigationEntries = [currentEntry];
		try {
			const registry = registerShare(cookies.get(VISITED_SHARES_COOKIE), ref);
			cookies.set(VISITED_SHARES_COOKIE, registry, { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: REGISTRY_TTL_MS / 1000 });
			const navigation = await discoverLibrary(createImmichProvider(fetch), { registryCookie: registry, sessionCookie: cookies.get(PAGES_SESSION_COOKIE), requestId: locals.requestId, current: [ref], known: [libraryEntry(ref, outcome.page.album, Boolean(outcome.page.album.thumbnailAssetId && outcome.page.assets.some((asset) => asset.id === outcome.page.album.thumbnailAssetId)))] });
			navigationEntries = navigation.entries.some((entry) => entry.href === currentHref) ? navigation.entries : [currentEntry, ...navigation.entries];
			logVisitedShareRegistry({ phase: 'register', result: 'success', entryCount: navigation.entries.length });
		} catch { /* Missing registry configuration must not break an otherwise authorized share. */ logVisitedShareRegistry({ phase: 'register', result: 'unavailable' }); }
		const { id: _albumId, ...browserAlbum } = outcome.page.album;
		const browserOutcome = { ...outcome, page: { ...outcome.page, album: browserAlbum } };
		logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: 200 });
		return { outcome: browserOutcome, navigation: { entries: navigationEntries, activeHref: currentHref }, indicatorEnabled: indicator.enabled };
	}
	if (outcome.kind === 'non-page') { logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: 404 }); return { outcome }; }
	if (outcome.kind === 'invalid-metadata') { logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: 422 }); return { outcome: { kind: 'presentation-error' as const, state: 'invalid' as const } }; }
	if (outcome.kind === 'password-required' || outcome.kind === 'unauthorized' || outcome.kind === 'not-found' || outcome.kind === 'unsupported') { cookies.set(PAGES_SESSION_COOKIE, '', { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0 }); logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: outcome.kind === 'not-found' ? 404 : 403 }); return { outcome }; }
	logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: 502 });
	return { outcome: { kind: 'presentation-error' as const, state: 'temporary' as const } };
};

export const actions = {
	default: async ({ params, request, cookies, fetch, url, locals }) => {
		const ref = parseSharedLinkRef(params.kind, params.ref);
		if (!ref) return fail(404, { kind: 'not-found' as const });
		const origin = request.headers.get('origin');
		if (origin && origin !== url.origin) return fail(403, { kind: 'login-failed' as const });
		const password = safePassword((await request.formData()).get('password'));
		if (!password) return fail(400, { kind: 'login-failed' as const });
		try {
			const provider = createImmichProvider(fetch);
			const result = await provider.loginSharedLink({ shareRef: ref, cookie: null, authorization: null }, password);
			if (!result.token) return fail(401, { kind: 'login-failed' as const });
			const value = addSession(cookies.get(PAGES_SESSION_COOKIE), ref, result.token);
			cookies.set(PAGES_SESSION_COOKIE, value, { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 86400 });
		} catch { return fail(401, { kind: 'login-failed' as const }); }
		return redirect(303, `${url.pathname}${url.search}`);
	}
};

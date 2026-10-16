import type { PageServerLoad } from './$types';
import { createImmichProvider } from '$server/immich/provider';
import { discoverLibrary } from '$server/library/discover';
import { VISITED_SHARES_COOKIE } from '$server/share/registry';
import { PAGES_SESSION_COOKIE } from '$server/share/session';
import { parseSharedLinkRef } from '$server/share/ref';

export const load: PageServerLoad = async ({ fetch, cookies, locals, url, setHeaders }) => {
	setHeaders({ 'cache-control': 'private, no-store' });
	const ref = parseSharedLinkRef(url.searchParams.get('kind') ?? undefined, url.searchParams.get('ref') ?? undefined);
	return { library: await discoverLibrary(createImmichProvider(fetch), { registryCookie: cookies.get(VISITED_SHARES_COOKIE), sessionCookie: cookies.get(PAGES_SESSION_COOKIE), requestId: locals.requestId, current: ref ? [ref] : undefined }) };
};

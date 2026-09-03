import type { PageServerLoad } from './$types';
import { userSessionContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { discoverLibrary } from '$server/library/discover';
export const load: PageServerLoad = async ({ request, fetch, setHeaders }) => { setHeaders({ 'cache-control': 'private, no-store' }); return { library: await discoverLibrary(createImmichProvider(fetch), userSessionContextFromRequest(request)) }; };

import type { PageServerLoad } from './$types';
import { decodeLibraryLocator } from '$server/immich/locator';
import { userSessionContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { assembleAuthenticatedAlbum } from '$server/page/assemble';
import { discoverLibrary } from '$server/library/discover';

const safeFailure = { kind: 'presentation-error' as const, state: 'temporary' as const };

export const load: PageServerLoad = async ({ params, request, fetch, setHeaders }) => {
	setHeaders({ 'cache-control': 'private, no-store' });
	const locator = decodeLibraryLocator(params.locator);
	if (!locator) return { outcome: { kind: 'presentation-error' as const, state: 'invalid' as const } };
	const context = userSessionContextFromRequest(request);
	if (!context.cookie && !context.authorization) return { outcome: safeFailure };
	const provider = createImmichProvider(fetch);
	try {
		const user = await provider.getCurrentUser(context);
		if (!user.data || user.status === 401 || user.status === 403) return { outcome: safeFailure };
		const [album, assets] = await Promise.all([provider.getAlbum(context, locator.albumId), provider.getAlbumAssets(context, locator.albumId)]);
		if (!album.data || !assets.data || album.status === 401 || album.status === 403 || assets.status === 401 || assets.status === 403) return { outcome: safeFailure };
		const outcome = await assembleAuthenticatedAlbum(provider, context, album.data, assets.data, params.locator);
		if (outcome.kind === 'invalid-metadata' || outcome.kind === 'non-page') return { outcome: safeFailure };
		if (outcome.kind !== 'page') return { outcome };
		const library = await discoverLibrary(provider, context);
		return {
			outcome,
			navigation: {
				entries: library.kind === 'ready' ? library.entries : [],
				activeHref: `/library/page/${encodeURIComponent(params.locator)}`
			}
		};
	} catch {
		return { outcome: safeFailure };
	}
};

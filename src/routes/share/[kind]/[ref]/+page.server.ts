import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { authContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { assembleDirectShare } from '$server/page/assemble';
import { parseSharedLinkRef } from '$server/share/ref';
import { logDirectShareBoundary, logDirectShareOutcome } from '$server/share/diagnostics';

export const load: PageServerLoad = async ({ params, request, locals, fetch }) => {
	const pathname = new URL(request.url).pathname;
	logDirectShareBoundary({ phase: 'start', method: request.method, pathname });
	const ref = parseSharedLinkRef(params.kind, params.ref);
	if (!ref) {
		logDirectShareOutcome({ outcome: 'not-found', method: request.method, pathname });
		logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: 404 });
		error(404, 'Share not found');
	}
	let outcome: Awaited<ReturnType<typeof assembleDirectShare>>;
	try {
		outcome = await assembleDirectShare(createImmichProvider(fetch), authContextFromRequest(request, ref), locals.requestId);
	} catch {
		outcome = { kind: 'upstream-error', requestId: locals.requestId };
	}
	logDirectShareOutcome({ outcome: outcome.kind, method: request.method, pathname,
		metadataReason: outcome.kind === 'invalid-metadata' ? outcome.metadataReason : undefined });
	if (outcome.kind === 'page') { logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: 200 }); return { outcome }; }
	if (outcome.kind === 'non-page') { logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: 404 }); error(404, 'This album is not a Pages presentation'); }
	if (outcome.kind === 'invalid-metadata') { logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: 422 }); return { outcome: { kind: 'presentation-error' as const, state: 'invalid' as const } }; }
	if (outcome.kind === 'password-required') { logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: 401 }); error(401, 'This share requires authentication'); }
	if (outcome.kind === 'unauthorized') { logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: 403 }); error(403, 'This share is not authorized'); }
	if (outcome.kind === 'not-found') { logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: 404 }); error(404, 'Share not found'); }
	if (outcome.kind === 'unsupported') { logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: 502 }); error(502, 'This share is not supported'); }
	logDirectShareBoundary({ phase: 'end', method: request.method, pathname, status: 502 });
	error(502, 'Immich is unavailable');
};

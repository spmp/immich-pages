import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { authContextFromRequest } from '$server/immich/auth-context';
import { createImmichProvider } from '$server/immich/provider';
import { assembleDirectShare } from '$server/page/assemble';
import { parseSharedLinkRef } from '$server/share/ref';
import { logDirectShareOutcome } from '$server/share/diagnostics';

export const load: PageServerLoad = async ({ params, request, locals, fetch }) => {
	const ref = parseSharedLinkRef(params.kind, params.ref);
	if (!ref) {
		logDirectShareOutcome({ requestId: locals.requestId, outcome: 'not-found', method: request.method, pathname: new URL(request.url).pathname });
		error(404, 'Share not found');
	}
	let outcome: Awaited<ReturnType<typeof assembleDirectShare>>;
	try {
		outcome = await assembleDirectShare(createImmichProvider(fetch), authContextFromRequest(request, ref), locals.requestId);
	} catch {
		outcome = { kind: 'upstream-error', requestId: locals.requestId };
	}
	logDirectShareOutcome({ requestId: locals.requestId, outcome: outcome.kind, method: request.method, pathname: new URL(request.url).pathname,
		metadataReason: outcome.kind === 'invalid-metadata' ? outcome.metadataReason : undefined });
	if (outcome.kind === 'page') return { outcome };
	if (outcome.kind === 'non-page') error(404, 'This album is not a Pages presentation');
	if (outcome.kind === 'invalid-metadata') error(422, 'This presentation has invalid metadata');
	if (outcome.kind === 'password-required') error(401, 'This share requires authentication');
	if (outcome.kind === 'unauthorized') error(403, 'This share is not authorized');
	if (outcome.kind === 'not-found') error(404, 'Share not found');
	if (outcome.kind === 'unsupported') error(502, 'This share is not supported');
	error(502, 'Immich is unavailable');
};

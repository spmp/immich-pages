import { redactPathname } from '../../../hooks.server';
import type { DirectShareOutcome } from '../immich/types';

type OutcomeKind = DirectShareOutcome['kind'];

const statusByOutcome: Record<OutcomeKind, number> = {
	page: 200,
	'non-page': 404,
	'invalid-metadata': 422,
	'password-required': 401,
	unauthorized: 403,
	'not-found': 404,
	unsupported: 502,
	'upstream-error': 502
};

const statusCategory = (status: number) => {
	if (status >= 200 && status < 300) return 'success';
	if (status >= 400 && status < 500) return 'client-error';
	if (status >= 500 && status < 600) return 'server-error';
	return 'other';
};

export function logDirectShareOutcome({
	requestId,
	outcome,
	method,
	pathname,
	status
}: {
	requestId: string;
	outcome: OutcomeKind;
	method: string;
	pathname: string;
	status?: number;
}) {
	const resolvedStatus = status ?? statusByOutcome[outcome];
	console.info(JSON.stringify({
		event: 'direct-share.outcome',
		requestId,
		outcomeKind: outcome,
		status: resolvedStatus,
		statusCategory: statusCategory(resolvedStatus),
		method,
		pathname: redactPathname(pathname)
	}));
}

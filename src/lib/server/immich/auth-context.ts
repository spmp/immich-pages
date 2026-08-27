import type { SharedLinkRef } from '$server/share/ref';

export type AuthContext = {
	cookie: string | null;
	authorization: string | null;
	shareRef: SharedLinkRef;
};

export function authContextFromRequest(request: Request, shareRef: SharedLinkRef): AuthContext {
	return {
		cookie: request.headers.get('cookie'),
		authorization: request.headers.get('authorization'),
		shareRef
	};
}

export function upstreamHeaders(context: AuthContext): Headers {
	const headers = new Headers({ accept: 'application/json' });
	if (context.cookie) headers.set('cookie', context.cookie);
	if (context.authorization) headers.set('authorization', context.authorization);
	return headers;
}

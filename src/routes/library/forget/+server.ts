import type { RequestHandler } from './$types';
import { forgetShare, REGISTRY_TTL_MS, VISITED_SHARES_COOKIE } from '$server/share/registry';
import { PAGES_SESSION_COOKIE, removeSession } from '$server/share/session';
import { parseSharedLinkRef } from '$server/share/ref';

const SHARE_HREF = /^\/share\/(key|slug)\/([^/?#]+)$/;
const cookieOptions = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' } as const;

/**
 * Remove one journey from the visitor's library. The library only ever lives in this browser's
 * own cookies, so this forgets it here and nowhere else: the share itself is untouched in Immich,
 * and opening its link again puts it back. Any saved password access for it is forgotten too.
 */
export const POST: RequestHandler = async ({ request, url, cookies }) => {
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) return new Response(null, { status: 403 });
	let href: unknown;
	try { href = ((await request.json()) as { href?: unknown })?.href; } catch { return new Response(null, { status: 400 }); }
	const match = typeof href === 'string' ? SHARE_HREF.exec(href) : null;
	let value: string | undefined;
	try { value = match ? decodeURIComponent(match[2]) : undefined; } catch { value = undefined; }
	const ref = match && value ? parseSharedLinkRef(match[1], value) : null;
	if (!ref) return new Response(null, { status: 400 });
	try {
		cookies.set(VISITED_SHARES_COOKIE, forgetShare(cookies.get(VISITED_SHARES_COOKIE), ref), { ...cookieOptions, maxAge: REGISTRY_TTL_MS / 1000 });
		const session = cookies.get(PAGES_SESSION_COOKIE);
		if (session) {
			const remaining = removeSession(session, ref);
			cookies.set(PAGES_SESSION_COOKIE, remaining ?? '', { ...cookieOptions, maxAge: remaining ? 86400 : 0 });
		}
	} catch { return new Response(null, { status: 503 }); }
	return new Response(null, { status: 204, headers: { 'cache-control': 'private, no-store' } });
};

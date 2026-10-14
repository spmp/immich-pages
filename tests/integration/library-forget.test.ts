import { describe, expect, it } from 'vitest';
import { POST } from '../../src/routes/library/forget/+server';
import { decodeRegistry, registerShare, VISITED_SHARES_COOKIE } from '../../src/lib/server/share/registry';
import { addSession, PAGES_SESSION_COOKIE, sessionForShare } from '../../src/lib/server/share/session';

process.env.PAGES_VISITED_SHARES_SECRET = 'test-visited-shares-secret-that-is-long-enough';
process.env.PAGES_SESSION_SECRET = 'test-session-secret-that-is-at-least-32-characters-long';

function event(body: unknown, cookieValues: Record<string, string>, origin = 'https://pages.test') {
	const set = new Map<string, { value: string; options: Record<string, unknown> }>();
	return {
		set,
		event: {
			request: new Request('https://pages.test/library/forget', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) }),
			url: new URL('https://pages.test/library/forget'),
			cookies: { get: (name: string) => cookieValues[name], set: (name: string, value: string, options: Record<string, unknown>) => set.set(name, { value, options }) }
		}
	};
}

const call = (input: ReturnType<typeof event>) => (POST as unknown as (event: unknown) => Promise<Response>)(input.event);

describe('removing a journey from the library', () => {
	it('drops the share from the visited-shares cookie and forgets any saved access to it', async () => {
		const registry = registerShare(registerShare(undefined, { kind: 'key', value: 'keep-me' }), { kind: 'slug', value: 'drop-me' });
		const session = addSession(addSession(undefined, { kind: 'slug', value: 'drop-me' }, 'token-drop'), { kind: 'key', value: 'keep-me' }, 'token-keep');
		const input = event({ href: '/share/slug/drop-me' }, { [VISITED_SHARES_COOKIE]: registry, [PAGES_SESSION_COOKIE]: session });
		const response = await call(input);
		expect(response.status).toBe(204);
		const written = input.set.get(VISITED_SHARES_COOKIE);
		expect(written?.options).toMatchObject({ path: '/', httpOnly: true, secure: true, sameSite: 'lax' });
		expect(decodeRegistry(written?.value, Date.now())?.entries.map((entry) => entry.value)).toEqual(['keep-me']);
		const remainingSession = input.set.get(PAGES_SESSION_COOKIE)?.value;
		expect(sessionForShare(remainingSession, { kind: 'slug', value: 'drop-me' }).token).toBeNull();
		expect(sessionForShare(remainingSession, { kind: 'key', value: 'keep-me' }).token).toBe('token-keep');
	});

	it('accepts the share link exactly as the library shows it, percent-encoding included', async () => {
		const registry = registerShare(undefined, { kind: 'key', value: 'Ab-_9' });
		const input = event({ href: '/share/key/Ab-_9' }, { [VISITED_SHARES_COOKIE]: registry });
		expect((await call(input)).status).toBe(204);
		expect(decodeRegistry(input.set.get(VISITED_SHARES_COOKIE)?.value, Date.now())?.entries).toEqual([]);
	});

	it('refuses requests from another site and anything that is not a share link', async () => {
		const registry = registerShare(undefined, { kind: 'key', value: 'keep-me' });
		const foreign = event({ href: '/share/key/keep-me' }, { [VISITED_SHARES_COOKIE]: registry }, 'https://evil.test');
		expect((await call(foreign)).status).toBe(403);
		expect(foreign.set.size).toBe(0);
		for (const href of ['/library', '//evil.test/share/key/x', '/share/other/x', '/share/key/bad%2Fref', 'https://pages.test/share/key/x', 42]) {
			const bad = event({ href }, { [VISITED_SHARES_COOKIE]: registry });
			expect((await call(bad)).status).toBe(400);
			expect(bad.set.size).toBe(0);
		}
	});
});

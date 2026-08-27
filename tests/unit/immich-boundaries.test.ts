import { describe, expect, it, vi } from 'vitest';
import { parseSharedLinkRef } from '../../src/lib/server/share/ref';
import { createImmichProvider } from '../../src/lib/server/immich/provider';
import { assembleDirectShare } from '../../src/lib/server/page/assemble';
import { readBoundedText, requestImmich } from '../../src/lib/server/immich/client';
import validPage from '../fixtures/shared-link/valid-page.json';
import malformed from '../fixtures/shared-link/malformed-response.json';
import errors from '../fixtures/shared-link/error-responses.json';
import permissions from '../fixtures/shared-link/permission-cases.json';

const context = (kind: 'key' | 'slug' = 'key') => ({
	shareRef: { kind, value: 'opaque-ref' as const },
	cookie: 'immich_shared_link_token=visitor-only',
	authorization: 'Bearer visitor-only'
});

describe('Immich boundary contracts', () => {
	it('forwards exactly the allowlisted request headers and matching query', async () => {
		const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
			const url = new URL(input.toString());
			expect(url.toString()).toBe('https://immich.example/api/shared-links/me?key=opaque-ref');
			expect(Object.fromEntries(new Headers(init?.headers).entries())).toEqual({
			accept: 'application/json', authorization: 'Bearer visitor-only', cookie: 'immich_shared_link_token=visitor-only'
		});
			return new Response(JSON.stringify(validPage));
		});
		const outcome = await assembleDirectShare(createImmichProvider(fetchMock, 'https://immich.example'), context(), 'request-1');
		expect(outcome.kind).toBe('page');
		expect(JSON.stringify(outcome)).not.toContain('visitor-only');
	});

	it.each(['key', 'slug'] as const)('uses only the explicit %s query', async (kind) => {
		const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
			const url = new URL(input.toString());
			expect(url.searchParams.get(kind)).toBe('opaque-ref');
			expect(url.searchParams.get(kind === 'key' ? 'slug' : 'key')).toBeNull();
			return new Response(JSON.stringify(validPage));
		});
		await assembleDirectShare(createImmichProvider(fetchMock, 'https://immich.example'), context(kind), 'request-2');
	});

	it('maps upstream failures without exposing response bodies', async () => {
		for (const [name, expected] of [['unauthorized', 'unauthorized'], ['forbidden', 'unauthorized'], ['notFound', 'not-found'], ['serverError', 'upstream-error']] as const) {
			const fixture = errors[name];
			const provider = createImmichProvider(vi.fn(async () => new Response(JSON.stringify(fixture.body), { status: fixture.status })), 'https://immich.example');
			const outcome = await assembleDirectShare(provider, context(), `request-${name}`);
			expect(outcome).toEqual(expected === 'upstream-error' ? { kind: expected, requestId: `request-${name}` } : { kind: expected });
			expect(JSON.stringify(outcome)).not.toContain('private');
		}
	});

	it('fails closed for malformed DTOs and incomplete permitted references', async () => {
		const provider = createImmichProvider(vi.fn(async () => new Response(JSON.stringify(malformed))), 'https://immich.example');
		expect((await assembleDirectShare(provider, context(), 'request-malformed')).kind).toBe('unsupported');
	});

	it('keeps empty assets and permission flags safe, and binds one album', async () => {
		const provider = createImmichProvider(vi.fn(async () => new Response(JSON.stringify(permissions.emptyAssets))), 'https://immich.example');
		const outcome = await assembleDirectShare(provider, context(), 'request-empty');
		expect(outcome).toMatchObject({ kind: 'page', page: { album: { id: 'album-empty' }, assets: [], showMetadata: false, allowDownload: false } });

		const second = createImmichProvider(vi.fn(async () => new Response(JSON.stringify(permissions.secondAlbum))), 'https://immich.example');
		const secondOutcome = await assembleDirectShare(second, context(), 'request-one');
		expect(secondOutcome).toMatchObject({ kind: 'page', page: { album: { id: 'album-authorized' } } });
		expect(JSON.stringify(secondOutcome)).not.toContain('album-other');
	});

	it('maps a password-bearing share without returning its password', async () => {
		const provider = createImmichProvider(vi.fn(async () => new Response(JSON.stringify(permissions.passwordRequired))), 'https://immich.example');
		expect(await assembleDirectShare(provider, context(), 'request-password')).toEqual({ kind: 'password-required' });
	});

	it('rejects missing and unknown route kinds before upstream access', () => {
		expect(parseSharedLinkRef(undefined, 'opaque-ref')).toBeNull();
		expect(parseSharedLinkRef('unknown', 'opaque-ref')).toBeNull();
	});

	it('enforces the response size bound', async () => {
		await expect(readBoundedText(new Response('12345'), 4)).rejects.toThrow('response-too-large');
	});

	it('rejects an oversized streamed body without reading later chunks', async () => {
		let reads = 0;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('1234'));
				controller.enqueue(new TextEncoder().encode('5678'));
				controller.enqueue(new TextEncoder().encode('should-not-be-read'));
				controller.close();
			},
			pull() {
				reads += 1;
			}
		});
		await expect(readBoundedText(new Response(body), 5)).rejects.toThrow('response-too-large');
		 expect(reads).toBe(0);
	});

	it('rejects dishonest chunked and declared response sizes', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('123456'));
				controller.close();
			}
		});
		await expect(readBoundedText(new Response(body), 5)).rejects.toThrow('response-too-large');
		await expect(readBoundedText(new Response('ok', { headers: { 'content-length': '6' } }), 5)).rejects.toThrow('response-too-large');
	});

	it('rejects non-album shares, malformed identifiers, and strips unknown DTO fields', async () => {
		const nonAlbum = { ...validPage, type: 'INDIVIDUAL' };
		const provider = createImmichProvider(vi.fn(async () => new Response(JSON.stringify(nonAlbum))), 'https://immich.example');
		expect((await assembleDirectShare(provider, context(), 'request-non-album')).kind).toBe('unsupported');

		const malformedId = { ...validPage, album: { ...validPage.album, id: '' } };
		const malformedProvider = createImmichProvider(vi.fn(async () => new Response(JSON.stringify(malformedId))), 'https://immich.example');
		expect((await assembleDirectShare(malformedProvider, context(), 'request-empty-id')).kind).toBe('unsupported');

		const unknown = { ...validPage, privateToken: 'must-not-cross', album: { ...validPage.album, privateNote: 'must-not-cross' } };
		const unknownProvider = createImmichProvider(vi.fn(async () => new Response(JSON.stringify(unknown))), 'https://immich.example');
		const outcome = await assembleDirectShare(unknownProvider, context(), 'request-unknown');
		expect(JSON.stringify(outcome)).not.toContain('must-not-cross');
	});

	it('aborts a request at the transport timeout', async () => {
		const fetchMock = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')));
		}));
		await expect(requestImmich('https://immich.example', '/api/server/version', { ...context(), shareRef: { kind: 'key', value: 'health' } }, fetchMock, { timeoutMs: 1 })).rejects.toMatchObject({ name: 'AbortError' });
	});
});

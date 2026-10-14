import { describe, expect, it } from 'vitest';
import { discoverLibrary } from '../../src/lib/server/library/discover';
import { encodeRegistry } from '../../src/lib/server/share/registry';
import type { ImmichProvider } from '../../src/lib/server/immich/provider';
import type { SharedLinkRef } from '../../src/lib/server/share/ref';

process.env.PAGES_VISITED_SHARES_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.PAGES_SESSION_SECRET = 'test-session-secret-that-is-at-least-32-characters-long';

const refs: SharedLinkRef[] = [
	{ kind: 'key', value: 'newest' },
	{ kind: 'slug', value: 'older-journey' },
	{ kind: 'key', value: 'revoked' }
];
const registry = encodeRegistry({ version: 1, entries: refs.map((ref, index) => ({ ...ref, firstSeenAt: Date.now() + index, lastSeenAt: Date.now() + index, expiresAt: Date.now() + 100_000 })) });
const page = (ref: SharedLinkRef, date: string, title = ref.value) => ({
	status: 200,
	data: {
		id: `11111111-1111-4111-8111-11111111111${ref.kind === 'key' ? '1' : '2'}`,
		description: `---\nimmich-presentation:\n  type: journey\n  version: 1\n  date: ${date}\n---\nHello`,
		password: null,
		userId: '22222222-2222-4222-8222-222222222222',
		key: ref.value,
		type: 'ALBUM' as const,
		createdAt: date,
		expiresAt: null,
		slug: ref.kind === 'slug' ? ref.value : null,
		album: { id: '11111111-1111-4111-8111-111111111111', albumName: title, description: `---\nimmich-presentation:\n  type: journey\n  version: 1\n  date: ${date}\n---\nHello`, assets: [] },
		assets: [], allowUpload: false, allowDownload: false, showMetadata: true
	}
});

function provider(responses: Map<string, ReturnType<typeof page> | { status: number }>) {
	return {
		getSharedLink: async (context: { shareRef: SharedLinkRef }) => responses.get(`${context.shareRef.kind}:${context.shareRef.value}`) ?? { status: 404 },
		getMapMarkers: async () => ({ status: 200, data: [] }),
		getThumbnail: async () => ({ status: 404 }),
		getVideoPlayback: async () => ({ status: 404 })
	} as unknown as ImmichProvider;
}

describe('share-registry library discovery', () => {
	it('uses only registry refs, never a user session, and returns original share links newest first', async () => {
		const result = await discoverLibrary(provider(new Map<string, any>([
			['key:newest', page(refs[0], '2025-01-01', 'Newest')],
			['slug:older-journey', page(refs[1], '2024-01-01', 'Older')],
			['key:revoked', { status: 403 }]
		])), { registryCookie: registry, sessionCookie: undefined, requestId: 'test' });

		expect(result.kind).toBe('ready');
		expect(result.entries.map((entry) => entry.title)).toEqual(['Newest', 'Older']);
		expect(result.entries.map((entry) => entry.href)).toEqual(['/share/key/newest', '/share/slug/older-journey']);
		expect(JSON.stringify(result)).not.toContain('11111111-1111');
	});

	it('returns a safe empty state for a missing or fully unauthorized registry', async () => {
		expect((await discoverLibrary(provider(new Map()), { registryCookie: undefined, sessionCookie: undefined, requestId: 'test' })).kind).toBe('empty');
		expect((await discoverLibrary(provider(new Map([['key:newest', { status: 403 }]])), { registryCookie: registry, sessionCookie: undefined, requestId: 'test' })).kind).toBe('empty');
	});

	it('freshly reauthorizes every discovery and removes a ref after revocation', async () => {
		const responses = new Map<string, any>([['key:newest', page(refs[0], '2025-01-01', 'Newest')]]);
		const calls: string[] = [];
		const freshProvider = {
			...provider(responses),
			getSharedLink: async (context: { shareRef: SharedLinkRef }) => {
				calls.push(`${context.shareRef.kind}:${context.shareRef.value}`);
				return responses.get(`${context.shareRef.kind}:${context.shareRef.value}`) ?? { status: 404 };
			}
		} as ImmichProvider;
		const context = { registryCookie: encodeRegistry({ version: 1, entries: [{ ...refs[0], firstSeenAt: Date.now(), lastSeenAt: Date.now(), expiresAt: Date.now() + 100_000 }] }), sessionCookie: undefined, requestId: 'test' };
		expect((await discoverLibrary(freshProvider, context)).kind).toBe('ready');
		responses.set('key:newest', { status: 403 });
		expect((await discoverLibrary(freshProvider, context)).kind).toBe('empty');
		expect(calls).toEqual(['key:newest', 'key:newest']);
	});

	// The library used to stop at 8 because each entry cost a complete page assembly -- map
	// markers, the routed path, the rendered narrative -- one after another, on every library
	// AND every share page view. A list row needs a title, dates and a thumbnail.
	describe('at library scale', () => {
		const many: SharedLinkRef[] = Array.from({ length: 50 }, (_, index) => ({ kind: 'slug', value: `journey-${String(index).padStart(2, '0')}` }));
		const manyRegistry = () => encodeRegistry({ version: 1, entries: many.map((ref, index) => ({ ...ref, firstSeenAt: Date.now() + index, lastSeenAt: Date.now() + index, expiresAt: Date.now() + 100_000 })) });
		const withMap = (ref: SharedLinkRef, date: string) => {
			const response = page(ref, date);
			const description = `---\nimmich-presentation:\n  type: journey\n  version: 1\n  date: ${date}\n  map:\n    enabled: true\n    source: brouter-web\n    url: "https://brouter.de/brouter-web/#lonlats=1,2;3,4&profile=trekking"\n---\nHello`;
			return { ...response, data: { ...response.data, description, album: { ...response.data.album, description } } };
		};

		it('lists fifty visited shares', async () => {
			const responses = new Map<string, any>(many.map((ref, index) => [`slug:${ref.value}`, page(ref, `2024-01-${String((index % 28) + 1).padStart(2, '0')}`)]));
			const result = await discoverLibrary(provider(responses), { registryCookie: manyRegistry(), sessionCookie: undefined, requestId: 'test' });
			expect(result.kind).toBe('ready');
			expect(result.entries).toHaveLength(50);
		});

		it('builds a list entry without fetching map markers or resolving a route', async () => {
			let markerCalls = 0;
			const responses = new Map<string, any>(many.slice(0, 3).map((ref) => [`slug:${ref.value}`, withMap(ref, '2024-05-01')]));
			const lean = { ...provider(responses), getMapMarkers: async () => { markerCalls += 1; return { status: 200, data: [] }; } } as ImmichProvider;
			const result = await discoverLibrary(lean, { registryCookie: manyRegistry(), sessionCookie: undefined, requestId: 'test' });
			expect(result.entries.map((entry) => entry.title)).toEqual(['journey-00', 'journey-01', 'journey-02']);
			expect(result.entries[0].date).toEqual({ start: '2024-05-01', end: '2024-05-01' });
			expect(markerCalls).toBe(0);
		});

		it('looks shares up a few at a time, not one after another and not all at once', async () => {
			let open = 0;
			let peak = 0;
			const responses = new Map<string, any>(many.map((ref) => [`slug:${ref.value}`, page(ref, '2024-01-01')]));
			const slow = { ...provider(responses), getSharedLink: async (context: { shareRef: SharedLinkRef }) => {
				open += 1; peak = Math.max(peak, open);
				await new Promise((resolve) => setTimeout(resolve, 5));
				open -= 1;
				return responses.get(`${context.shareRef.kind}:${context.shareRef.value}`) ?? { status: 404 };
			} } as ImmichProvider;
			const result = await discoverLibrary(slow, { registryCookie: manyRegistry(), sessionCookie: undefined, requestId: 'test' });
			expect(result.entries).toHaveLength(50);
			expect(peak).toBeGreaterThan(1);
			expect(peak).toBeLessThanOrEqual(8);
		});

		it('does not look up again the share whose page was just assembled for this request', async () => {
			const calls: string[] = [];
			const responses = new Map<string, any>(many.slice(0, 3).map((ref) => [`slug:${ref.value}`, page(ref, '2024-01-01')]));
			const counting = { ...provider(responses), getSharedLink: async (context: { shareRef: SharedLinkRef }) => { calls.push(context.shareRef.value); return responses.get(`slug:${context.shareRef.value}`) ?? { status: 404 }; } } as ImmichProvider;
			const registryCookie = encodeRegistry({ version: 1, entries: many.slice(0, 3).map((ref, index) => ({ ...ref, firstSeenAt: Date.now() + index, lastSeenAt: Date.now() + index, expiresAt: Date.now() + 100_000 })) });
			const result = await discoverLibrary(counting, { registryCookie, sessionCookie: undefined, requestId: 'test', current: [many[1]], known: [{ ref: many[1], entry: { href: '/share/slug/journey-01', title: 'Already assembled' }, sortDate: '2030-01-01' }] });
			expect(calls.sort()).toEqual(['journey-00', 'journey-02']);
			expect(result.entries.map((entry) => entry.title)).toEqual(['Already assembled', 'journey-00', 'journey-02']);
		});
	});
});

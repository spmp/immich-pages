import { describe, expect, it } from 'vitest';
import { parsePresentationDocument } from '../../src/lib/server/presentation/frontmatter';
import { deriveDisplayDate, selectHero } from '../../src/lib/server/presentation/model';

const share = { album: { albumThumbnailAssetId: 'b' }, assets: [
	{ id: 'a', originalFileName: 'first.jpg', type: 'IMAGE' },
	{ id: 'b', originalFileName: 'cover.jpg', type: 'IMAGE' }
]} as never;

describe('normalized presentation model seams', () => {
	it('selects only authorized heroes using filename, id, cover, fallback precedence', () => {
		const parsed = parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  version: 1\n  hero:\n    filename: cover.jpg\n---');
		expect(parsed.kind).toBe('valid');
		if (parsed.kind === 'valid') expect(selectHero(parsed.config, share)?.id).toBe('b');
	});

	it('keeps extension seams explicit and serializable', () => {
		const model = { markers: [], routeData: null, warnings: ['unknown-fields'], errors: [] };
		expect(JSON.parse(JSON.stringify(model))).toEqual(model);
	});

	it('uses explicit date, authorized asset dates, then album dates', () => {
		const base = { album: { albumThumbnailAssetId: 'b' }, assets: [{ id: 'a', originalFileName: 'first.jpg', type: 'IMAGE', localDateTime: '2025-02-02T00:00:00Z' }, { id: 'b', originalFileName: 'cover.jpg', type: 'IMAGE', localDateTime: '2025-01-01T00:00:00Z' }] };
		const explicit = parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  version: 1\n  date: 2024-01-01\n---');
		if (explicit.kind === 'valid') expect(deriveDisplayDate(explicit.config, base as never)).toEqual({ start: '2024-01-01', end: '2024-01-01' });
		const empty = parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  version: 1\n---');
		if (empty.kind === 'valid') expect(deriveDisplayDate(empty.config, base as never)).toEqual({ start: '2025-01-01T00:00:00Z', end: '2025-02-02T00:00:00Z' });
	});
});

import { describe, expect, it } from 'vitest';
import { parsePresentationDocument } from '../../src/lib/server/presentation/frontmatter';
import { deriveDisplayDate, projectHdrAssets, selectHero, type NormalizedPageModel } from '../../src/lib/server/presentation/model';

const share = { album: { albumThumbnailAssetId: 'b' }, assets: [
	{ id: 'a', originalFileName: 'first.jpg', type: 'IMAGE' },
	{ id: 'b', originalFileName: 'cover.jpg', type: 'IMAGE' }
]} as never;

describe('normalized presentation model seams', () => {
	it('keeps normalized gradient data serializable and bounded in the model contract', () => {
		const parsed = parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  version: 1\n  gradient:\n    direction: to bottom\n    top: "#ABCDEF"\n    bottom: "#123456"\n---');
		expect(parsed.kind).toBe('valid');
		if (parsed.kind === 'valid') {
			const model = { presentation: parsed.config } as Pick<NormalizedPageModel, 'presentation'>;
		expect(model.presentation.gradient).toEqual({ auto: false, direction: 'to bottom', top: '#abcdef', bottom: '#123456' });
			expect(JSON.stringify(model)).not.toContain('rgba');
		}
	});

	it('selects only authorized heroes using filename, id, cover, fallback precedence', () => {
		const parsed = parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  version: 1\n  hero:\n    filename: cover.jpg\n---');
		expect(parsed.kind).toBe('valid');
		if (parsed.kind === 'valid') expect(selectHero(parsed.config, share)?.id).toBe('b');
	});

	it('uses explicit date, authorized asset dates, then album dates', () => {
		const base = { album: { albumThumbnailAssetId: 'b' }, assets: [{ id: 'a', originalFileName: 'first.jpg', type: 'IMAGE', localDateTime: '2025-02-02T00:00:00Z' }, { id: 'b', originalFileName: 'cover.jpg', type: 'IMAGE', localDateTime: '2025-01-01T00:00:00Z' }] };
		const explicit = parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  version: 1\n  date: 2024-01-01\n---');
		if (explicit.kind === 'valid') expect(deriveDisplayDate(explicit.config, base as never)).toEqual({ start: '2024-01-01', end: '2024-01-01' });
		const empty = parsePresentationDocument('---\nimmich-presentation:\n  type: journey\n  version: 1\n---');
		if (empty.kind === 'valid') expect(deriveDisplayDate(empty.config, base as never)).toEqual({ start: '2025-01-01T00:00:00Z', end: '2025-02-02T00:00:00Z' });
	});

	it('preserves normalized response order and stable duplicate ties for HDR projection', () => {
		const projected = projectHdrAssets([
			{ id: 'b', type: 'IMAGE', thumbnail: '/b', sourceMimeType: 'image/heic', sourceWidth: 2, sourceHeight: 2 },
			{ id: 'a', type: 'IMAGE', thumbnail: '/a', sourceMimeType: 'image/heic', sourceWidth: 2, sourceHeight: 2 },
			{ id: 'a', type: 'IMAGE', thumbnail: '/a-duplicate', sourceMimeType: 'image/heic', sourceWidth: 2, sourceHeight: 2 }
		]);
		expect(projected.map((asset) => asset.id)).toEqual(['b', 'a', 'a']);
		expect(projected.map((asset) => asset.position)).toEqual([0, 1, 2]);
	});
});

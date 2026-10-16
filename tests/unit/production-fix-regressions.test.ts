import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { selectAuthoritativeAlbumAssets } from '../../src/lib/server/immich/provider';
import { resolveHdrReadinessState } from '../../src/lib/media/hdr-readiness';

describe('production UAT regressions', () => {
	 it('uses the ordered nested album projection when both DTO projections are present', () => {
		const topLevel = [{ id: '00000000-0000-0000-0000-000000000001' }, { id: '00000000-0000-0000-0000-000000000002' }];
		const nested = [{ id: '00000000-0000-0000-0000-000000000002' }, { id: '00000000-0000-0000-0000-000000000001' }];
		expect(selectAuthoritativeAlbumAssets(topLevel, nested).map((asset) => asset.id)).toEqual([nested[0].id, nested[1].id]);
	});

	// WR-01 (08-21-PLAN.md Task 3): the adapter previously trusted a non-empty nested list as-is,
	// even when it disagreed with top-level membership. data.assets after this call feeds every
	// downstream membership check in provider.ts (e.g. getFullsizeImage's share.data.assets.find),
	// so a nested-only ID must never surface -- it names an asset the share's own top-level list
	// never declared.
	it('drops a nested-only ID absent from top-level membership', () => {
		const topLevel = [{ id: 'top-1' }, { id: 'top-2' }];
		const nested = [{ id: 'top-2' }, { id: 'nested-only' }, { id: 'top-1' }];
		const result = selectAuthoritativeAlbumAssets(topLevel, nested);
		expect(result.map((asset) => asset.id).sort()).toEqual(['top-1', 'top-2']);
		expect(result.some((asset) => asset.id === 'nested-only')).toBe(false);
	});

	// WR-01 Test 3: nested disagreeing by OMISSION must never narrow membership either -- a
	// top-level-only ID is retained, appended in top-level's own relative order after the
	// intersection nested does cover.
	it('retains a top-level-only ID missing from nested, in top-level order, after the nested intersection', () => {
		const topLevel = [{ id: 'top-1' }, { id: 'top-2' }, { id: 'top-3' }];
		const nested = [{ id: 'top-3' }, { id: 'top-1' }];
		const result = selectAuthoritativeAlbumAssets(topLevel, nested);
		expect(result.map((asset) => asset.id)).toEqual(['top-3', 'top-1', 'top-2']);
	});

	it('has explicit terminal and unsupported readiness states instead of permanent initial preparing', () => {
		expect(resolveHdrReadinessState(undefined, { supported: false })).toBe('unsupported');
		expect(resolveHdrReadinessState({ targeted: 0, completed: 0, failed: 0, skipped: 0 }, { supported: true })).toBe('empty');
		expect(resolveHdrReadinessState({ targeted: 1, completed: 1, failed: 0, skipped: 0 }, { supported: true })).toBe('ready');
	});

	it('clears the lightbox indicator when an HDR promotion gives up', () => {
		const source = readFileSync(new URL('../../src/lib/components/journal/Lightbox.svelte', import.meta.url), 'utf8');
		const marker = 'HDR video: failed';
		const failureBranch = source.slice(source.indexOf(marker));
		expect(failureBranch.slice(0, 500)).toContain('updateHdrIndicator()');
	});
});

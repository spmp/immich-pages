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

import { describe, expect, it, vi } from 'vitest';
import { logDirectShareOutcome, logShareAssetProjection, logShareHeroSelection } from '../../src/lib/server/share/diagnostics';

describe('direct-share outcome diagnostics', () => {
	it('logs a redacted, structured outcome without request secrets', () => {
		const infoLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		const pathname = '/share/key/secret-ref';

		logDirectShareOutcome({
			requestId: 'request-123',
			outcome: 'invalid-metadata',
			method: 'GET',
			pathname,
			status: 422,
			metadataReason: 'unsupported-version'
		});

		expect(infoLog).toHaveBeenCalledOnce();
		const line = String(infoLog.mock.calls[0][0]);
		expect(JSON.parse(line)).toEqual({
			event: 'direct-share.outcome',
			requestId: 'request-123',
			outcomeKind: 'invalid-metadata',
			status: 422,
			statusCategory: 'client-error',
			method: 'GET',
			pathname: '/share/key/:ref',
			metadataReason: 'unsupported-version'
		});
		expect(line).not.toContain('secret-ref');
		expect(line).not.toContain('token');
		infoLog.mockRestore();
	});

	it('logs only safe projection and hero facts', () => {
		const infoLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		logShareAssetProjection({ type: 'ALBUM', topLevelAssetCount: 0, nestedAlbumAssetCount: 3, normalizedAssetCount: 3 });
		logShareHeroSelection({ requestId: 'request-123', selection: 'album-cover' });
		expect(JSON.parse(String(infoLog.mock.calls[0][0]))).toEqual({ event: 'direct-share.asset-projection', type: 'ALBUM', topLevelAssetCount: 0, nestedAlbumAssetCount: 3, normalizedAssetCount: 3 });
		expect(JSON.parse(String(infoLog.mock.calls[1][0]))).toEqual({ event: 'direct-share.hero-selection', requestId: 'request-123', selection: 'album-cover' });
		infoLog.mockRestore();
	});
});

import { describe, expect, it, vi } from 'vitest';
import { logDirectShareBoundary, logDirectShareOutcome, logMapRouteResult, logMetadataParse, logModelOutput, logSharedLinkResponse, logShareAssetProjection, logShareHeroSelection } from '../../src/lib/server/share/diagnostics';

describe('direct-share outcome diagnostics', () => {
	it('logs a redacted, structured outcome without request secrets', () => {
		const infoLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		const pathname = '/share/key/secret-ref';

		logDirectShareOutcome({
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
		logShareHeroSelection({ selection: 'album-cover' });
		expect(JSON.parse(String(infoLog.mock.calls[0][0]))).toEqual({ event: 'direct-share.asset-projection', type: 'ALBUM', topLevelAssetCount: 0, nestedAlbumAssetCount: 3, normalizedAssetCount: 3 });
		expect(JSON.parse(String(infoLog.mock.calls[1][0]))).toEqual({ event: 'direct-share.hero-selection', selection: 'album-cover' });
		infoLog.mockRestore();
	});

	it('logs direct-share lifecycle facts without identifiers or request data', () => {
		const infoLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		logDirectShareBoundary({ phase: 'start', method: 'GET', pathname: '/share/slug/not-a-secret' });
		logSharedLinkResponse({ type: 'ALBUM', topLevelAssetCount: 0, nestedAlbumAssetCount: 3, normalizedAssetCount: 3 });
		logMetadataParse({ result: 'valid' });
		logModelOutput({ assetCount: 3, imageCount: 2, videoCount: 1, heroPresent: true, markerCount: 2, routeReady: true });
		const lines = infoLog.mock.calls.map(([line]) => String(line));
		expect(lines[0]).toContain('"pathname":"/share/slug/:ref"');
		expect(lines.join('\n')).not.toMatch(/not-a-secret|https?:|cookie|authorization|description|body|requestId|assetId/i);
		infoLog.mockRestore();
	});

	it('logs only allowlisted route outcome facts', () => {
		const infoLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		logMapRouteResult({ adapter: 'brouter-web', warnings: ['brouter-profile-unsupported'], durationMs: 12.8 });
		const line = String(infoLog.mock.calls[0][0]);
		expect(JSON.parse(line)).toEqual({ event: 'direct-share.route-result', adapter: 'brouter-web', category: 'unsupported-profile', durationMs: 12 });
		expect(line).not.toMatch(/coordinates|https?:|trekking|body|cookie|authorization|lonlats|token/i);
		infoLog.mockRestore();
	});

	it.each([
		[['map-route-invalid'], 'malformed-route'],
		[['brouter-endpoint-unsafe'], 'endpoint-configuration'],
		[['brouter-timeout'], 'timeout'],
		[['brouter-request-failed'], 'upstream-failure'],
		[['brouter-response-too-large'], 'response-limit'],
		[[], 'resolved']
	] as const)('reduces route warnings to safe category %s', (warnings, category) => {
		const infoLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		logMapRouteResult({ adapter: 'geojson', warnings, durationMs: 999999 });
		expect(JSON.parse(String(infoLog.mock.calls[0][0]))).toEqual({ event: 'direct-share.route-result', adapter: 'geojson', category, durationMs: 60000 });
		infoLog.mockRestore();
	});
});

import { describe, expect, it, vi } from 'vitest';
import { handleError, redactPathname } from '../../src/hooks.server';

describe('server error diagnostics', () => {
	it('redacts share refs while preserving route shape', () => {
		expect(redactPathname('/share/key/secret-ref')).toBe('/share/key/:ref');
		expect(redactPathname('/share/secret-ref')).toBe('/share/:ref');
		expect(redactPathname('/health')).toBe('/health');
	});

	it('logs only safe request fields and returns a safe public 404', () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const event = {
			locals: { requestId: 'request-123' },
			request: new Request('https://pages.example/share/secret-ref?token=do-not-log', { method: 'GET' }),
			url: new URL('https://pages.example/share/secret-ref?token=do-not-log')
		} as Parameters<typeof handleError>[0]['event'];

		const result = handleError({
			error: { status: 404, message: 'secret raw error' },
			event,
			status: 404,
			message: 'Not found'
		});

		expect(result).toEqual({ status: 404, message: 'Not found' });
		expect(errorLog).toHaveBeenCalledOnce();
		const line = String(errorLog.mock.calls[0][0]);
		expect(JSON.parse(line)).toEqual({
			requestId: 'request-123',
			status: 404,
			method: 'GET',
			pathname: '/share/:ref'
		});
		expect(line).not.toContain('token');
		expect(line).not.toContain('secret');
		errorLog.mockRestore();
	});

	it('does not expose raw errors for unexpected failures', () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const result = handleError({
			error: new Error('upstream body and credentials'),
			event: {
				locals: { requestId: 'request-456' },
				request: new Request('https://pages.example/health', { method: 'POST' }),
				url: new URL('https://pages.example/health')
			} as Parameters<typeof handleError>[0]['event'],
			status: 500,
			message: 'Internal server error'
		});

		expect(result).toEqual({ status: 500, message: 'Internal server error' });
		expect(String(errorLog.mock.calls[0][0])).not.toContain('upstream body');
		errorLog.mockRestore();
	});
});

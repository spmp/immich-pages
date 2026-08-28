import type { Handle, HandleServerError } from '@sveltejs/kit';

const publicMessage = (status: number) => {
	if (status === 404) return 'Not found';
	if (status === 400) return 'Bad request';
	return 'Internal server error';
};

const safeStatus = (status: unknown) =>
	typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;

export const redactPathname = (pathname: string) => {
	const segments = pathname.split('/');
	if (segments[1] !== 'share') return pathname;
	if (segments.length >= 3 && (segments[2] === 'key' || segments[2] === 'slug')) {
		segments[3] = ':ref';
		return segments.slice(0, 4).join('/');
	}
	if (segments.length >= 3 && segments[2]) return '/share/:ref';
	return pathname;
};

export const handle: Handle = async ({ event, resolve }) => {
	const requestId = crypto.randomUUID();
	event.locals.requestId = requestId;
	const response = await resolve(event);
	response.headers.set('x-request-id', requestId);
	return response;
};

export const handleError: HandleServerError = ({ error, event, status: errorStatus }) => {
	const status = safeStatus(
		errorStatus ?? (error && typeof error === 'object' && 'status' in error ? error.status : undefined)
	);
	console.error(
		JSON.stringify({
			requestId: event.locals.requestId,
			status,
			method: event.request.method,
			pathname: redactPathname(event.url.pathname)
		})
	);

	return { status, message: publicMessage(status) };
};

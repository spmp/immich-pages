import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const requestId = crypto.randomUUID();
	event.locals.requestId = requestId;
	const response = await resolve(event);
	response.headers.set('x-request-id', requestId);
	return response;
};

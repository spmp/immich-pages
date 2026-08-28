export type PresentationStateKind = 'invalid' | 'empty' | 'temporary';

type Copy = { heading: string; body: string; action: string };

const COPY: Record<PresentationStateKind, Copy> = {
	empty: {
		heading: 'No photographs to show yet',
		body: 'This journey has no viewable media. Return to the album or try again later.',
		action: 'Try again'
	},
	invalid: {
		heading: 'Presentation details need attention',
		body: 'This page needs a small correction before it can be shown. Ask the album owner to review its presentation details.',
		action: 'Return to the album'
	},
	temporary: {
		heading: 'This journey is unavailable right now',
		body: 'Please check the link and try again.',
		action: 'Try again'
	}
};

export function presentationCopy(state: PresentationStateKind): Copy {
	return COPY[state];
}

export type RouteErrorKind = 'not-found' | 'unauthorized' | 'temporary';

export function routeErrorCopy(status: number): { kind: RouteErrorKind; heading: string; body: string; action: string } {
	if (status === 404) return { kind: 'not-found', heading: 'This journey could not be found', body: 'Please check the link and try again.', action: 'Try again' };
	if (status === 401 || status === 403) return { kind: 'unauthorized', heading: 'This journey is private', body: 'Check your share link or ask the album owner for access.', action: 'Try again' };
	return { kind: 'temporary', heading: 'This journey is unavailable right now', body: 'Please check the link and try again.', action: 'Try again' };
}

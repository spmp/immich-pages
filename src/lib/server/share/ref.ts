export type SharedLinkRef = { kind: 'key' | 'slug'; value: string };

const REF = /^[A-Za-z0-9_-]{1,128}$/;

export function parseSharedLinkRef(kind: string | undefined, value: string | undefined): SharedLinkRef | null {
	if ((kind !== 'key' && kind !== 'slug') || !value || !REF.test(value)) return null;
	return { kind, value };
}

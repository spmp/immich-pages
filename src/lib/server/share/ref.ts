export type SharedLinkRef = { kind: 'key' | 'slug'; value: string };

const REF = /^[A-Za-z0-9_-]{1,128}$/;

export function parseSharedLinkRef(kind: string | undefined, value: string | undefined): SharedLinkRef | null {
	if ((kind !== 'key' && kind !== 'slug') || !value || !REF.test(value)) return null;
	return { kind, value };
}

/**
 * Canonical per-share scope identifier used by the HDR prewarm coordinator's background schedule()
 * calls AND the interactive media routes' submitInteractive()/ensureInteractive() calls. Both must
 * compute this identically -- any divergence files an interactive job under a different
 * coordinator bucket than its share's own background work, where that share's own readiness
 * snapshot can never see it. See Specialist Review finding 1, .planning/debug/hdr-caching-uat-20261010.md.
 */
export function operationScope(ref: SharedLinkRef): string {
	return `share-${ref.kind}-${ref.value}`.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 160);
}

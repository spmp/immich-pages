export type HdrLookahead = 0 | { kind: 'count'; value: number } | { kind: 'all' };

export type HdrProjectionAsset = {
	id: string;
	eligible: boolean;
	position: number;
	sourceIdentity: string;
	width?: number;
	height?: number;
};

export const DEFAULT_HDR_LOOKAHEAD = 10;
export const MAX_HDR_LOOKAHEAD = 100;

export type HdrIndicatorParse = {
	enabled: boolean;
	category: 'default' | 'explicit' | 'invalid';
};

/** Reduce the private deployment setting to a server-only boolean and safe category. */
export function parseHdrIndicator(value: unknown): HdrIndicatorParse {
	if (value === 'on') return { enabled: true, category: 'explicit' };
	if (value === 'off') return { enabled: false, category: 'explicit' };
	if (value === undefined || value === null) return { enabled: true, category: 'default' };
	return { enabled: true, category: 'invalid' };
}

export function parseHdrLookahead(value: unknown = process.env.HDR_PREWARM_LOOKAHEAD): HdrLookahead {
	if (value === 0 || value === '0') return 0;
	if (value === 'all') return { kind: 'all' };
	if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_HDR_LOOKAHEAD) {
		return { kind: 'count', value };
	}
	if (typeof value === 'string' && /^(?:[1-9][0-9]?)$/.test(value)) {
		const parsed = Number(value);
		if (parsed <= MAX_HDR_LOOKAHEAD) return { kind: 'count', value: parsed };
	}
	return { kind: 'count', value: DEFAULT_HDR_LOOKAHEAD };
}

/** Eligibility is filtered before look-ahead is counted. The input order is authoritative. */
export function eligibleAssets<T extends HdrProjectionAsset>(assets: readonly T[]): T[] {
	return assets.filter((asset) => asset.eligible && asset.id.length > 0);
}

export function targetLookahead<T extends HdrProjectionAsset>(
	assets: readonly T[],
	activePosition: number,
	lookahead: HdrLookahead
): T[] {
	if (lookahead === 0) return [];
	const eligible = eligibleAssets(assets);
	const position = Number.isInteger(activePosition) ? Math.max(0, activePosition) : 0;
	const ahead = eligible.filter((asset) => asset.position > position);
	return lookahead.kind === 'all' ? ahead : ahead.slice(0, lookahead.value);
}

export function targetAllEligible<T extends HdrProjectionAsset>(assets: readonly T[]): T[] {
	return eligibleAssets(assets);
}

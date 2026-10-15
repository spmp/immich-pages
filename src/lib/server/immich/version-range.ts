/**
 * The Immich releases Pages is known to work with, as reported by /health/immich. Informational
 * only: Pages renders the same on any Immich version; this only decides what the health endpoint
 * calls "supported". Set IMMICH_SUPPORTED_VERSION to override (an exact version, or a range).
 */
export const DEFAULT_SUPPORTED_IMMICH_VERSIONS = '>=3.1.0 <4.0.0';

type Version = [number, number, number];

function parseVersion(value: string): Version | null {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compare(a: Version, b: Version): number {
	for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
	return 0;
}

/**
 * Whether `version` satisfies `range`: comparisons (`>=`, `>`, `<=`, `<`, `=`, or a bare version for
 * an exact match) separated by spaces, all of which must hold -- e.g. `>=3.1.0 <4.0.0`. Anything
 * unreadable is treated as not satisfied.
 */
export function satisfiesVersionRange(version: string, range: string): boolean {
	const actual = parseVersion(version);
	const clauses = range.trim().split(/\s+/).filter(Boolean);
	if (!actual || clauses.length === 0) return false;
	return clauses.every((clause) => {
		const match = /^(>=|<=|>|<|=)?(.+)$/.exec(clause);
		const bound = match ? parseVersion(match[2]) : null;
		if (!match || !bound) return false;
		const order = compare(actual, bound);
		switch (match[1]) {
			case '>=': return order >= 0;
			case '<=': return order <= 0;
			case '>': return order > 0;
			case '<': return order < 0;
			default: return order === 0;
		}
	});
}

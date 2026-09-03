export type Visibility = { allow?: string[] } | undefined;
export function visibilityAllows(visibility: Visibility, user: { id: string; email?: string; name?: string }): boolean {
	if (!visibility) return true;
	if (!Array.isArray(visibility.allow)) return false;
	const claims = [user.id, user.email, user.name].filter((claim): claim is string => typeof claim === 'string' && claim.length > 0);
	return visibility.allow.every((claim) => typeof claim === 'string' && !claim.includes(':')) && visibility.allow.some((claim) => claims.includes(claim));
}

export type Visibility = { allow?: string[] } | undefined;
export function visibilityAllows(_visibility: Visibility, _user: { id: string; email?: string; name?: string }): boolean { return true; }

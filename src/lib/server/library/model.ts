export type NavigationEntry = { href: string; title: string; date?: { start: string; end: string }; thumbnail?: string };
export type LibraryResult = { kind: 'ready' | 'empty' | 'access' | 'temporary'; entries: NavigationEntry[]; warnings: string[] };
export type LibraryDiscoveryContext = { registryCookie?: string; sessionCookie?: string; requestId: string; current?: import('$server/share/ref').SharedLinkRef[] };

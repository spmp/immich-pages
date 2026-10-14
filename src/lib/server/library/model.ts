export type NavigationEntry = { href: string; title: string; date?: { start: string; end: string }; thumbnail?: string };
export type LibraryResult = { kind: 'ready' | 'empty' | 'access' | 'temporary'; entries: NavigationEntry[]; warnings: string[] };
/** A share already authorized and assembled in this request, so discovery need not ask again. */
export type KnownLibraryEntry = { ref: import('$server/share/ref').SharedLinkRef; entry: NavigationEntry; sortDate: string };
export type LibraryDiscoveryContext = { registryCookie?: string; sessionCookie?: string; requestId: string; current?: import('$server/share/ref').SharedLinkRef[]; known?: KnownLibraryEntry[] };

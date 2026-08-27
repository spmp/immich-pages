import { z } from 'zod';

const AssetSchema = z.object({
	id: z.string().min(1),
	type: z.string().optional(),
	originalFileName: z.string().optional(),
	thumbnailPath: z.string().optional(),
	viewPath: z.string().optional()
}).passthrough();

export const SharedLinkResponseSchema = z.object({
	type: z.string().optional(),
	album: z.object({
		id: z.string().min(1),
		albumName: z.string().optional(),
		description: z.string().nullable().optional()
	}).passthrough(),
	assets: z.array(AssetSchema),
	showMetadata: z.boolean().optional().default(false),
	allowDownload: z.boolean().optional().default(false),
	password: z.string().nullable().optional()
}).passthrough();

export type SharedLinkResponse = z.infer<typeof SharedLinkResponseSchema>;

export type AuthorizedAlbumPage = {
	album: { id: string; title: string; description: string };
	assets: Array<{ id: string; type?: string; fileName?: string; thumbnail: string; view: string }>;
	showMetadata: boolean;
	allowDownload: boolean;
};

export type DirectShareOutcome =
	| { kind: 'page'; page: AuthorizedAlbumPage }
	| { kind: 'non-page' }
	| { kind: 'invalid-metadata' }
	| { kind: 'password-required' }
	| { kind: 'not-found' }
	| { kind: 'unauthorized' }
	| { kind: 'unsupported' }
	| { kind: 'upstream-error'; requestId: string };

import { z } from 'zod';

const IdentifierSchema = z.string().min(1).max(256);
const DescriptorPathSchema = z.string().min(1).max(2048);

const AssetSchema = z.object({
	id: IdentifierSchema,
	type: z.string().min(1).max(64).optional(),
	originalFileName: z.string().max(1024).optional(),
	thumbnailPath: DescriptorPathSchema.optional(),
	viewPath: DescriptorPathSchema.optional()
});

export const SharedLinkResponseSchema = z.object({
	type: z.literal('ALBUM').optional(),
	album: z.object({
		id: IdentifierSchema,
		albumName: z.string().optional(),
		description: z.string().nullable().optional()
	}),
	assets: z.array(AssetSchema),
	showMetadata: z.boolean().optional().default(false),
	allowDownload: z.boolean().optional().default(false),
	password: z.string().nullable().optional()
});

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

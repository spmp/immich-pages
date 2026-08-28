import { z } from 'zod';

const IdentifierSchema = z.uuidv4();


export const AssetResponseSchema = z.object({
	id: IdentifierSchema,
	type: z.string().min(1).max(64),
	originalFileName: z.string().max(1024).optional(),
	originalMimeType: z.string().max(256).optional(),
	localDateTime: z.string().max(128).optional(),
	duration: z.number().int().nonnegative().nullable().optional(),
	livePhotoVideoId: z.string().max(256).nullable().optional(),
	hasMetadata: z.boolean().optional(),
	width: z.number().int().nonnegative().nullable().optional(),
	height: z.number().int().nonnegative().nullable().optional()
});

export type SharedAsset = z.infer<typeof AssetResponseSchema>;

export const SharedLinkResponseSchema = z.object({
	id: IdentifierSchema,
	description: z.string().nullable(),
	password: z.string().nullable(),
	userId: IdentifierSchema,
	key: z.string().min(1),
	type: z.literal('ALBUM'),
	createdAt: z.string().min(1),
	expiresAt: z.string().nullable(),
	album: z.object({
		id: IdentifierSchema,
		albumName: z.string(),
		description: z.string().nullable()
	}).optional(),
	assets: z.array(AssetResponseSchema),
	allowUpload: z.boolean(),
	allowDownload: z.boolean(),
	showMetadata: z.boolean(),
	slug: z.string().nullable()
});

export type SharedLinkResponse = z.infer<typeof SharedLinkResponseSchema>;

export type AuthorizedAlbumPage = {
	album: { id: string; title: string; description: string };
	assets: Array<{ id: string; type: string; fileName?: string; thumbnail: string }>;
	showMetadata: boolean;
	allowDownload: boolean;
};

export type MetadataFailureReason =
	| 'oversized'
	| 'missing-closing-delimiter'
	| 'duplicate-field'
	| 'malformed-quoting'
	| 'unsupported-type'
	| 'unsupported-version';

export type DirectShareOutcome =
	| { kind: 'page'; page: AuthorizedAlbumPage }
	| { kind: 'non-page' }
	| { kind: 'invalid-metadata'; metadataReason?: MetadataFailureReason }
	| { kind: 'password-required' }
	| { kind: 'not-found' }
	| { kind: 'unauthorized' }
	| { kind: 'unsupported' }
	| { kind: 'upstream-error'; requestId: string };

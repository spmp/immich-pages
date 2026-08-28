import { z } from 'zod';

const IdentifierSchema = z.uuidv4();


export const AssetResponseSchema = z.object({
	id: IdentifierSchema,
	type: z.string().min(1).max(64),
	originalFileName: z.string().max(1024).optional(),
	originalMimeType: z.string().max(256).optional(),
	localDateTime: z.string().max(128).optional(),
	createdAt: z.string().max(128).optional(),
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
		description: z.string().nullable(),
		albumThumbnailAssetId: IdentifierSchema.nullable().optional(),
		startDate: z.string().max(128).nullable().optional(),
		endDate: z.string().max(128).nullable().optional(),
		updatedAt: z.string().max(128).optional()
	}).optional(),
	assets: z.array(AssetResponseSchema),
	allowUpload: z.boolean(),
	allowDownload: z.boolean(),
	showMetadata: z.boolean(),
	slug: z.string().nullable()
});

export type SharedLinkResponse = z.infer<typeof SharedLinkResponseSchema>;

export type AuthorizedAlbumPage = {
	album: { id: string; title: string; description: string; thumbnailAssetId?: string; startDate?: string; endDate?: string; updatedAt?: string };
	assets: Array<{ id: string; type: string; fileName?: string; thumbnail: string; caption?: string }>;
	showMetadata: boolean;
	allowDownload: boolean;
	narrativeHtml?: string;
	presentation?: unknown;
	hero?: { id: string; thumbnail: string } | null;
	markers?: [];
	routeData?: null;
	warnings?: string[];
	errors?: string[];
};

export type MetadataFailureReason =
	| 'oversized'
	| 'missing-closing-delimiter'
	| 'duplicate-field'
	| 'malformed-quoting'
	| 'unsupported-type'
	| 'unsupported-version'
	| 'malformed-frontmatter'
	| 'duplicate-key'
	| 'alias-not-allowed'
	| 'non-object-root'
	| 'resource-limit'
	| 'invalid-schema'
	| 'unknown-fields';

export type DirectShareOutcome =
	| { kind: 'page'; page: AuthorizedAlbumPage }
	| { kind: 'non-page' }
	| { kind: 'invalid-metadata'; metadataReason?: MetadataFailureReason }
	| { kind: 'password-required' }
	| { kind: 'not-found' }
	| { kind: 'unauthorized' }
	| { kind: 'unsupported' }
	| { kind: 'upstream-error'; requestId: string };

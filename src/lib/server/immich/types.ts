import { z } from 'zod';

// Any RFC 9562 UUID: Immich issues v4 today, but a move to time-ordered v7 IDs must not make
// every share unreadable. Still strictly hex-and-dashes, so an ID is always safe in a URL path.
export const ImmichIdSchema = z.uuid();
const IdentifierSchema = ImmichIdSchema;


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

export const UserResponseSchema = z.object({ id: IdentifierSchema, name: z.string().max(512).optional(), email: z.string().max(512).optional() });
export type UserResponse = z.infer<typeof UserResponseSchema>;

export const AlbumResponseSchema = z.object({
	id: IdentifierSchema,
	albumName: z.string().max(1024),
	description: z.string().max(64 * 1024).nullable().optional(),
	albumThumbnailAssetId: IdentifierSchema.nullable().optional(),
	startDate: z.string().max(128).nullable().optional(),
	endDate: z.string().max(128).nullable().optional(),
	updatedAt: z.string().max(128).optional(),
	assetCount: z.number().int().nonnegative().optional(),
	/** Immich's only asset-ordering control: a global chronological direction, not a manual per-asset position. Immich defaults to 'desc' (newest first). */
	order: z.enum(['asc', 'desc']).optional()
});
export type AlbumResponse = z.infer<typeof AlbumResponseSchema>;

export const MapMarkerResponseSchema = z.object({
	id: IdentifierSchema,
	lat: z.number().finite(),
	lon: z.number().finite(),
	city: z.string().nullable(),
	state: z.string().nullable(),
	country: z.string().nullable()
});
export const MapMarkerResponseArraySchema = z.array(MapMarkerResponseSchema);
export type MapMarkerResponse = z.infer<typeof MapMarkerResponseSchema>;

// Only what Pages reads. Immich's other shared-link fields (id, key, slug, userId, createdAt,
// expiresAt, allowUpload, description) are dropped rather than validated, so a release
// that renames, removes or retypes one of them cannot stop shares loading. Built against v3.3.1;
// tests/unit/immich-version-tolerance.test.ts holds this to fields that release guarantees.
export const SharedLinkResponseSchema = z.object({
	type: z.enum(['ALBUM', 'INDIVIDUAL']),
	// Only picks the page shown (password prompt); Immich itself withholds the photos until the
	// password is given, so an unreadable value falls back to "none" without exposing anything.
	password: z.string().nullable().optional().catch(undefined),
	album: z.object({
		id: IdentifierSchema,
		albumName: z.string(),
		description: z.string().nullable().optional(),
		albumThumbnailAssetId: IdentifierSchema.nullable().optional(),
		startDate: z.string().max(128).nullable().optional(),
		endDate: z.string().max(128).nullable().optional(),
		updatedAt: z.string().max(128).optional(),
		assetCount: z.number().int().nonnegative().optional(),
		assets: z.array(AssetResponseSchema).optional(),
		order: z.enum(['asc', 'desc']).optional()
	}).optional(),
	assets: z.array(AssetResponseSchema),
	// Absent means no: Pages never offers a download, or shows metadata, Immich has not allowed.
	allowDownload: z.boolean().default(false),
	showMetadata: z.boolean().default(false)
});

export type SharedLinkResponse = z.infer<typeof SharedLinkResponseSchema>;

export const SearchResponseSchema = z.object({
	assets: z.object({ items: z.array(AssetResponseSchema) }),
	albums: z.unknown().optional()
});

export type AuthorizedAlbumPage = {
	album: { id: string; title: string; description: string; thumbnailAssetId?: string; startDate?: string; endDate?: string; updatedAt?: string };
	assets: Array<{ id: string; type: string; fileName?: string; thumbnail: string; caption?: string }>;
	showMetadata: boolean;
	allowDownload: boolean;
	narrativeHtml?: string;
	presentation?: unknown;
	hero?: { id: string; thumbnail: string } | null;
  markers?: import('../map/types').MapMarker[];
  routeData?: import('../map/types').MapRoute | null;
	warnings?: string[];
	errors?: string[];
};

export type VideoPlaybackResult = { status: number; response?: Response; error?: 'malformed' | 'asset-mismatch' | 'not-video' };

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
	| { kind: 'page'; page: import('../presentation/model').NormalizedPageModel }
	| { kind: 'presentation-error'; state: 'invalid' | 'empty' | 'temporary' }
	| { kind: 'non-page' }
	| { kind: 'invalid-metadata'; metadataReason?: MetadataFailureReason }
	| { kind: 'password-required' }
	| { kind: 'not-found' }
	| { kind: 'unauthorized' }
	| { kind: 'unsupported' }
	| { kind: 'upstream-error'; requestId: string };

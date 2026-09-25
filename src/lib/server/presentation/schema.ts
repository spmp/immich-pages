import { z } from 'zod';

const SafeText = z.string().trim().min(1).max(512);
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((value) => value.toLowerCase());
const GradientSchema = z.object({
		auto: z.boolean().default(false),
		direction: z.enum(['to bottom', '135deg']).default('to bottom'),
		top: HexColor.optional(),
		bottom: HexColor.optional()
	}).strict().superRefine((gradient, ctx) => {
		if (!gradient.auto && (!gradient.top || !gradient.bottom)) {
			ctx.addIssue({ code: 'custom', path: ['top'], message: 'manual gradients require top and bottom colors' });
		}
		if (gradient.auto && (gradient.top || gradient.bottom)) {
			ctx.addIssue({ code: 'custom', path: ['auto'], message: 'automatic gradients cannot include manual colors' });
		}
	});
const MapSchema = z.object({
		// A map that gracefully degrades (no GPS -> just omitted, never fails the page) is safe to
		// default on, so a minimal/empty `immich-presentation:` still gets a useful page.
		enabled: z.boolean().default(true),
		source: z.enum(['auto', 'waypoints', 'geojson', 'brouter-web']).default('auto'),
		styleName: z.enum(['quiet-atlas']).default('quiet-atlas'),
		markerActivation: z.enum(['gallery', 'lightbox']).default('gallery'),
		showMarkerList: z.boolean().default(false),
		clustering: z.boolean().default(true),
		clusterRadius: z.number().int().min(8).max(128).default(24),
		waypoints: z.array(z.array(z.number()).length(2)).max(500).optional(),
		geojson: z.string().max(64 * 1024).optional(),
		url: z.string().url().max(2048).optional(),
		markerColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#c96b4b'),
		routeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#c96b4b'),
		routeWidth: z.number().int().min(1).max(8).default(3),
		routeStartColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#356859'),
		routeEndColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#c96b4b')
	}).superRefine((map, ctx) => {
		if (map.source !== 'brouter-web' && map.url !== undefined) ctx.addIssue({ code: 'custom', path: ['url'], message: 'url is only valid for brouter-web' });
		if (map.source === 'brouter-web' && map.url === undefined) ctx.addIssue({ code: 'custom', path: ['url'], message: 'brouter-web requires url' });
	});
const DateText = z.string().trim().min(1).max(64);
const AuthSchema = z.object({
	allow: z.object({ users: z.array(SafeText).min(1).max(256) }).strict()
}).strict();

export const PresentationSchema = z.object({
	// Both default so a bare `immich-presentation:` key (no sub-keys at all) is a complete,
	// minimal, fully-defaulted page -- the only requirement is the namespace key being present.
	type: z.literal('journey').default('journey'),
	version: z.preprocess((value) => value === '1' ? 1 : value, z.literal(1)).default(1),
	template: SafeText.default('journal'),
	hero: z.object({
		source: z.enum(['album-thumbnail', 'primary', 'filename', 'asset-id']).default('album-thumbnail'),
		filename: SafeText.optional(),
		assetId: z.string().uuid().optional()
	}).default({ source: 'album-thumbnail' }),
	date: DateText.optional(),
	dateRange: z.object({ start: DateText.optional(), end: DateText.optional() }).optional(),
	auth: AuthSchema.optional(),
	// Defaults derived from the sub-schemas themselves (MapSchema.parse({})), not a second
	// hand-written literal, so a field's default can never drift between the two declarations.
	map: MapSchema.default(MapSchema.parse({})),
	gallery: z.object({
		sort: z.literal('album').default('album'),
		showCaptions: z.boolean().default(true),
		showDates: z.boolean().default(false),
		captions: z.record(z.string().uuid(), z.string().trim().max(512)).default({}),
		fullWidth: z.array(z.string().uuid()).max(256).default([])
	}).default({ sort: 'album', showCaptions: true, showDates: false, captions: {}, fullWidth: [] }),
	gradient: GradientSchema.optional()
});

export type PresentationConfig = z.infer<typeof PresentationSchema>;

export function validatePresentation(value: unknown) {
	return PresentationSchema.safeParse(value);
}

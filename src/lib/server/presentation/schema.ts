import { z } from 'zod';

const SafeText = z.string().trim().min(1).max(512);
const MapSchema = z.object({
		enabled: z.boolean().default(false),
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

export const PresentationSchema = z.object({
	type: z.literal('journey'),
	version: z.preprocess((value) => value === '1' ? 1 : value, z.literal(1)),
	template: SafeText.default('journal'),
	hero: z.object({
		source: z.enum(['album-thumbnail', 'primary', 'filename', 'asset-id']).default('album-thumbnail'),
		filename: SafeText.optional(),
		assetId: z.string().uuid().optional()
	}).default({ source: 'album-thumbnail' }),
	date: DateText.optional(),
	dateRange: z.object({ start: DateText.optional(), end: DateText.optional() }).optional(),
	map: MapSchema.default({ enabled: false, source: 'auto', styleName: 'quiet-atlas', markerActivation: 'gallery', showMarkerList: false, clustering: true, clusterRadius: 24, markerColor: '#c96b4b', routeColor: '#c96b4b', routeWidth: 3, routeStartColor: '#356859', routeEndColor: '#c96b4b' }),
	gallery: z.object({
		sort: z.literal('album').default('album'),
		showCaptions: z.boolean().default(true),
		showDates: z.boolean().default(false),
		captions: z.record(z.string().uuid(), z.string().trim().max(512)).default({})
	}).default({ sort: 'album', showCaptions: true, showDates: false, captions: {} })
});

export type PresentationConfig = z.infer<typeof PresentationSchema>;

export function validatePresentation(value: unknown) {
	return PresentationSchema.safeParse(value);
}

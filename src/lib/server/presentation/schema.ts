import { z } from 'zod';

const SafeText = z.string().trim().min(1).max(512);
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
	map: z.object({
		enabled: z.boolean().default(false),
		source: z.enum(['auto', 'waypoints', 'geojson', 'brouter-web']).default('auto')
	}).default({ enabled: false, source: 'auto' }),
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

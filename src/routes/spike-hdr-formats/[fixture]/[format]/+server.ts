import type { RequestHandler } from './$types';
import { extractAppleHdrMetadata } from '$server/media/hdr-metadata';
import { encodeHdrMp4 } from '$server/media/hdr-compositor';
import { convertHeicToJpeg } from '$server/media/sdr-compositor';
import { composeHdrPpm, composeHdrPpmTunable, composeTestChartPpm, encodeAvifHdr, encodeJxlHdr, encodeTestChartSdrJpeg, encodeTestChartUltraHdrJpeg, encodeUltraHdrJpeg, parseGainMapOverrides, ppmToPng16, SPIKE_FORMATS, SPIKE_HDR_ENABLED, type GainMapOverrides, type SpikeFormatSlug, type SyntheticChartKind } from '$server/media/spike-hdr-formats';
import { isSpikeFixtureSlug, readSpikeFixture, SPIKE_HDR_FIXTURES } from '$server/media/spike-hdr-fixtures';

const noStore = { 'cache-control': 'private, no-store' };
const notFound = () => new Response('Not found', { status: 404, headers: noStore });

const FORMATS = new Map(SPIKE_FORMATS.map((format) => [format.slug, format]));
function isFormatSlug(value: string): value is SpikeFormatSlug { return FORMATS.has(value as SpikeFormatSlug); }

// Process-local only: this is a manual comparison spike, not the production cache contract.
const cache = new Map<string, Uint8Array>();

async function buildSyntheticChart(format: SpikeFormatSlug, kind: SyntheticChartKind): Promise<Uint8Array> {
	switch (format) {
		case 'sdr.jpg': return encodeTestChartSdrJpeg(kind);
		case 'hdr-video.mp4': return encodeHdrMp4(await composeTestChartPpm(kind));
		case 'ultrahdr.jpg': return encodeTestChartUltraHdrJpeg(kind);
		case 'avif-hdr.avif': return encodeAvifHdr(await ppmToPng16(await composeTestChartPpm(kind)));
		case 'jxl-hdr.jxl': return encodeJxlHdr(await composeTestChartPpm(kind));
		case 'heic-original.heic': throw new Error('spike-chart-has-no-original-heic');
	}
}

function overrideCacheSuffix(overrides: GainMapOverrides): string {
	return `${overrides.headroom ?? 'default'}:${overrides.gamma ?? 'default'}`;
}

export const GET: RequestHandler = async ({ params, url }) => {
	if (!SPIKE_HDR_ENABLED) return notFound();
	if (!isSpikeFixtureSlug(params.fixture) || !isFormatSlug(params.format)) return notFound();
	const overrides = parseGainMapOverrides(url.searchParams);
	const hasOverrides = overrides.headroom !== undefined || overrides.gamma !== undefined;
	const cacheKey = `${params.fixture}:${params.format}:${overrideCacheSuffix(overrides)}`;
	const cached = cache.get(cacheKey);
	if (cached) return new Response(cached.buffer as ArrayBuffer, { headers: { 'content-type': FORMATS.get(params.format)!.contentType, ...noStore } });

	try {
		let body: Uint8Array;
		const fixture = SPIKE_HDR_FIXTURES[params.fixture];
		if (fixture.synthetic) {
			body = await buildSyntheticChart(params.format, fixture.chartKind);
		} else {
			const input = await readSpikeFixture(params.fixture);
			switch (params.format) {
				case 'heic-original.heic': {
					body = input;
					break;
				}
				case 'sdr.jpg': {
					body = await convertHeicToJpeg(input);
					break;
				}
				default: {
					const metadata = await extractAppleHdrMetadata(input);
					if (!metadata) return new Response('Fixture has no usable Apple HDR gain-map metadata', { status: 422, headers: noStore });
					if (params.format === 'hdr-video.mp4') {
						const ppm = hasOverrides ? await composeHdrPpmTunable(input, metadata, overrides) : await composeHdrPpm(input, metadata);
						body = await encodeHdrMp4(ppm);
					} else if (params.format === 'ultrahdr.jpg') {
						body = await encodeUltraHdrJpeg(input, metadata, overrides);
					} else {
						const ppm = hasOverrides ? await composeHdrPpmTunable(input, metadata, overrides) : await composeHdrPpm(input, metadata);
						body = params.format === 'avif-hdr.avif' ? await encodeAvifHdr(await ppmToPng16(ppm)) : await encodeJxlHdr(ppm);
					}
				}
			}
		}
		cache.set(cacheKey, body);
		return new Response(body.buffer as ArrayBuffer, { headers: { 'content-type': FORMATS.get(params.format)!.contentType, 'content-length': String(body.byteLength), ...noStore } });
	} catch (error) {
		return new Response(`Spike encode failed: ${error instanceof Error ? error.message : 'unknown'}`, { status: 502, headers: noStore });
	}
};

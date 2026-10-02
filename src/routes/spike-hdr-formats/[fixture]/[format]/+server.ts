import type { RequestHandler } from './$types';
import { extractAppleHdrMetadata } from '$server/media/hdr-metadata';
import { composeHdr, encodeHdrMp4 } from '$server/media/hdr-compositor';
import { convertHeicToJpeg } from '$server/media/sdr-compositor';
import { composeHdrPpm, encodeAvifHdr, encodeJxlHdr, ppmToPng16, SPIKE_FORMATS, SPIKE_HDR_ENABLED, type SpikeFormatSlug } from '$server/media/spike-hdr-formats';
import { isSpikeFixtureSlug, readSpikeFixture } from '$server/media/spike-hdr-fixtures';

const noStore = { 'cache-control': 'private, no-store' };
const notFound = () => new Response('Not found', { status: 404, headers: noStore });

const FORMATS = new Map(SPIKE_FORMATS.map((format) => [format.slug, format]));
function isFormatSlug(value: string): value is SpikeFormatSlug { return FORMATS.has(value as SpikeFormatSlug); }

// Process-local only: this is a manual comparison spike, not the production cache contract.
const cache = new Map<string, Uint8Array>();

export const GET: RequestHandler = async ({ params }) => {
	if (!SPIKE_HDR_ENABLED) return notFound();
	if (!isSpikeFixtureSlug(params.fixture) || !isFormatSlug(params.format)) return notFound();
	const cacheKey = `${params.fixture}:${params.format}`;
	const cached = cache.get(cacheKey);
	if (cached) return new Response(cached.buffer as ArrayBuffer, { headers: { 'content-type': FORMATS.get(params.format)!.contentType, ...noStore } });

	try {
		const input = await readSpikeFixture(params.fixture);
		let body: Uint8Array;
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
					body = await encodeHdrMp4(await composeHdr(input, metadata));
				} else {
					const ppm = await composeHdrPpm(input, metadata);
					body = params.format === 'avif-hdr.avif' ? await encodeAvifHdr(await ppmToPng16(ppm)) : await encodeJxlHdr(ppm);
				}
			}
		}
		cache.set(cacheKey, body);
		return new Response(body.buffer as ArrayBuffer, { headers: { 'content-type': FORMATS.get(params.format)!.contentType, 'content-length': String(body.byteLength), ...noStore } });
	} catch (error) {
		return new Response(`Spike encode failed: ${error instanceof Error ? error.message : 'unknown'}`, { status: 502, headers: noStore });
	}
};

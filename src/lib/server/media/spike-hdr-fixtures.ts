import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Throwaway spike registry (.planning/spikes/) mapping short slugs to the real local Apple
 * HDR gain-map fixtures already used by the production HDR pipeline's own fixture matrix
 * (tests/resources/hdr/, gitignored, operator-supplied -- see docs/hdr-media.md). Never
 * baked into the production Dockerfile/image; only read when SPIKE_HDR_COMPARE=true.
 */
export const SPIKE_HDR_FIXTURES = {
	ref: { file: '2.HEIF', label: 'Fixture A (2.HEIF, preserved reference, landscape)', synthetic: false },
	alt: { file: '6.HEIC', label: 'Fixture B (6.HEIC, second real sample, landscape)', synthetic: false },
	chart: {
		file: null,
		synthetic: true,
		label: 'Synthetic test chart (spike 003): one no-boost control patch beside a 1.5x/2x/3x/4x/6x ladder, all pure white -- a flat strip means the gain map was ignored outright, a graduated one tells you exactly how many steps actually render'
	}
} as const;

export type SpikeFixtureSlug = keyof typeof SPIKE_HDR_FIXTURES;

export function isSpikeFixtureSlug(value: string): value is SpikeFixtureSlug {
	return Object.hasOwn(SPIKE_HDR_FIXTURES, value);
}

export async function readSpikeFixture(slug: SpikeFixtureSlug): Promise<Uint8Array> {
	const fixture = SPIKE_HDR_FIXTURES[slug];
	if (fixture.synthetic || !fixture.file) throw new Error('spike-fixture-synthetic-has-no-file');
	const dir = process.env.SPIKE_HDR_FIXTURES_DIR ?? 'tests/resources/hdr';
	return readFile(join(dir, fixture.file));
}

#!/usr/bin/env node
// Minimal real subprocess standing in for libheif's heif-convert in unit tests: parses the
// same `-q <n> -o <outputPath> <inputPath>` contract sdr-compositor.ts actually invokes, reads
// the real input file from disk, and writes real bytes to the real output path, so the test
// exercises genuine process/filesystem plumbing rather than a fully mocked spawn.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('-o');
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
const inputPath = args[args.length - 1];

if (!outputPath || !inputPath) {
	console.error('fake-heif-convert: missing -o or input path');
	process.exit(2);
}

const behavior = process.env.FAKE_HEIF_CONVERT_BEHAVIOR ?? 'success';
if (behavior === 'fail') {
	console.error('fake-heif-convert: forced failure');
	process.exit(1);
}
if (behavior === 'hang') {
	setInterval(() => {}, 1000);
} else if (behavior === 'empty') {
	writeFileSync(outputPath, Buffer.alloc(0));
} else {
	const input = readFileSync(inputPath);
	// Real minimal JPEG magic bytes followed by a byte derived from the real input, so tests can
	// assert the fake tool actually read the file it was given rather than fabricating output.
	writeFileSync(outputPath, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.from([input.length % 256])]));
}

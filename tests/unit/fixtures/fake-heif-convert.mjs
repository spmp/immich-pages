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
	// A genuine, browser-decodable 2x2 JPEG (real ffmpeg output, embedded as base64), not just
	// magic-number bytes: a fake bridge that produces bytes a real <img> can't decode causes
	// spurious "decode failed, fall back to thumbnail" noise anywhere this fixture is used in a
	// real browser (e.g. every asset in a mock gallery with HDR hints enabled), unrelated to
	// whatever the test actually intends to exercise. The trailing byte is derived from the real
	// input so tests can still assert the fake tool actually read the file it was given.
	const tinyJpeg = Buffer.from('/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjExLjEwMAD/2wBDAAgKCgsKCw0NDQ0NDRAPEBAQEBAQEBAQEBASEhIVFRUSEhIQEBISFBQVFRcXFxUVFRUXFxkZGR4eHBwjIyQrKzP/xABKAAEAAAAAAAAAAAAAAAAAAAAAAQEAAAAAAAAAAAAAAAAAAAAAEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAAgACAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AAA//2Q==', 'base64');
	writeFileSync(outputPath, Buffer.concat([tinyJpeg, Buffer.from([input.length % 256])]));
}

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const contract = JSON.parse(readFileSync(resolve(root, '.planning/archive/docs/phase-8-visual-system.contract.json'), 'utf8')) as Record<string, any>;
const prose = readFileSync(resolve(root, '.planning/archive/docs/phase-8-visual-system.md'), 'utf8').toLowerCase();
const topLevel = ['selectedFramework', 'selectedTheme', 'themeSelector', 'tokenSchema', 'surfacePaths', 'typography', 'mediaConstraints', 'backgroundGradient', 'deliveryGates', 'accessibility', 'motion', 'persistenceBoundary', 'unresolvedDecisions'];
const surfaces = {
  hero: 'src/lib/components/journal/JournalHero.svelte',
  narrative: 'src/lib/components/journal/JournalNarrative.svelte',
  gallery: 'src/lib/components/journal/JournalGallery.svelte',
  map: 'src/lib/components/journal/JourneyMapSlot.svelte',
  navigation: 'src/lib/components/navigation/PageNavigation.svelte',
  library: 'src/routes/library/+page.svelte',
  presentationState: 'src/lib/components/journal/PresentationState.svelte',
  lightbox: 'src/lib/components/journal/Lightbox.svelte'
};
const tokens = ['--theme-bg', '--theme-surface', '--theme-text', '--theme-muted', '--theme-accent', '--theme-rule', '--theme-focus', '--theme-radius', '--theme-content-width', '--theme-space-section', '--theme-font-heading', '--theme-font-body', '--theme-font-caption', '--theme-gradient-direction', '--theme-gradient-top', '--theme-gradient-bottom', '--theme-gradient'];

function assertResolved(value: unknown, label: string): void {
  expect(value, label).not.toBeNull();
  if (typeof value === 'string') {
    expect(value.trim(), label).not.toBe('');
    expect(value.toLowerCase(), label).not.toMatch(/unresolved|todo|tbd|decide later/);
  } else if (Array.isArray(value)) {
    for (const item of value) assertResolved(item, label);
  } else if (typeof value === 'object' && value) {
    for (const [key, item] of Object.entries(value)) assertResolved(item, `${label}.${key}`);
  }
}

describe('Phase 8 visual-system contract', () => {
  it('has exactly the required resolved top-level fields', () => {
    expect(Object.keys(contract).sort()).toEqual([...topLevel].sort());
    for (const field of topLevel) expect(contract).toHaveProperty(field);
    expect(contract.unresolvedDecisions).toEqual([]);
    assertResolved(contract.selectedFramework, 'selectedFramework');
    assertResolved(contract.selectedTheme, 'selectedTheme');
  });

  it('defines every semantic token with a type and value or range', () => {
    for (const token of tokens) {
      expect(contract.tokenSchema).toHaveProperty(token);
      expect(contract.tokenSchema[token].type).toBeTruthy();
      expect(contract.tokenSchema[token].valueOrRange).toBeTruthy();
    }
  });

  it('maps all required presentation surfaces to exact existing paths', () => {
    expect(contract.surfacePaths).toEqual(surfaces);
  });

  it('requires structured typography, media, accessibility, motion, and persistence rules', () => {
    for (const field of ['typography', 'mediaConstraints', 'accessibility', 'motion', 'persistenceBoundary']) {
      expect(Object.keys(contract[field]).length, field).toBeGreaterThan(0);
      assertResolved(contract[field], field);
    }
    expect(JSON.stringify(contract.mediaConstraints)).toMatch(/thumbnail\?size=fullsize/);
    expect(contract.mediaConstraints.imageView).toContain('never /original or /download');
    expect(JSON.stringify(contract.persistenceBoundary)).toMatch(/browser-local-only/);
    expect(JSON.stringify(contract.persistenceBoundary)).toMatch(/no server\/database\/Immich persistence/);
  });

  it('keeps prose and JSON in agreement for every contract scalar', () => {
    expect(prose).toContain('sveltekit 2 / svelte 5');
    expect(prose).toContain('monochrome reference photo-essay system');
    for (const token of tokens) expect(prose).toContain(token);
    for (const [surface, path] of Object.entries(surfaces)) {
      expect(prose).toContain(surface.toLowerCase());
      expect(prose).toContain(path.toLowerCase());
    }
    expect(prose).toContain('ui-serif, georgia, serif');
    expect(prose).toContain('ui-sans-serif, system-ui, sans-serif');
    expect(prose).toContain('system or locally reviewed');
    expect(prose).toContain('thumbnail-first');
    expect(prose).toContain('intrinsic-ratio');
    expect(prose).toContain('fullwidth');
    expect(prose).toContain('do not add filename chrome');
    expect(prose).toContain('thumbnail?size=fullsize');
    expect(prose).toContain('never request `/original` or `/download`');
    expect(prose).toContain('black photoswipe image/video viewer');
    expect(prose).toContain('/video/playback');
    expect(prose).toContain('progressive best-effort');
    expect(prose).toContain('physical hdr-capable devices');
    expect(prose).toContain('browser-local-only');
    expect(prose).toContain('no server, database, file-store, volume, or immich persistence');
    expect(prose).toContain('unresolveddecisions` is `[]');
  });
});

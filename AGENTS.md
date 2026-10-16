<!-- GSD:project-start source:PROJECT.md -->

## Project

**Immich Pages**

Immich Pages is a stateless presentation layer that renders selected Immich albums as rich pages, beginning with a high-quality travel/journey template. Users author pages entirely in Immich by editing album descriptions with versioned YAML frontmatter and Markdown, then sharing through Immich or an Immich-compatible authenticated session.

The architecture is generic enough for future photo essays, events, portfolios, weddings, project documentation, and other album presentations, while keeping Immich as the sole persistent source of truth.

**Core Value:** Make publishing a beautiful, shareable album presentation no harder than editing an Immich album description and sharing it.

### Constraints

- **Source of truth**: Immich owns albums, descriptions, assets, metadata, sharing, and authorization — prevents duplicate administration and preserves stateless recovery.
- **Statelessness**: No persistent per-page database, media store, or configuration store — deleting containers, caches, and volumes must not remove pages.
- **Technology**: TypeScript, Svelte, and SvelteKit are the default stack; MapLibre GL JS and GeoJSON are the default map stack — maintains alignment with Immich and supports lightweight deployment.
- **Security**: Album YAML and Markdown are untrusted input; validate schema, sanitize Markdown, disable arbitrary HTML, constrain route inputs, and prevent SSRF or code execution.
- **Compatibility**: Use supported current Immich APIs and isolate version-specific behavior in an adapter — avoids coupling to undocumented database tables.
- **Performance**: Prefer metadata and thumbnails, lazy-load gallery content, and keep large albums usable — first useful rendering must not require full-size originals.
- **Deployment**: Run cleanly in Docker without a required database or persistent application volume; support common reverse proxies.
- **License**: AGPL-3.0-only, aligned with Immich's current licensing and future upstream reuse.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Svelte | 5.56.10 | Component UI | Current Svelte major, aligns with Immich and supports small, inspectable components. |
| SvelteKit | 2.70.3 | Routing, SSR, server endpoints | Current npm release; SSR is useful for first render and auth-aware Immich fetching. |
| `@sveltejs/adapter-node` | 5.5.7 | Deployment | Produces a standalone Node server with no database or persistent volume requirement. |
| TypeScript | 6.0.2 | Application language | Pin the SvelteKit-compatible release exactly for strict DTO and outcome contracts. |
| Vite | 8.x-compatible | Build/dev server | SvelteKit and current MapLibre tooling are Vite-oriented. Let SvelteKit own the Vite integration. |

### Mapping and Data Formats

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| MapLibre GL JS | 6.6.0 | Browser map renderer | Open BSD-licensed WebGL map renderer with GeoJSON sources and configurable styles; avoids a Google Maps dependency. |
| `@types/geojson` | 7946.0.16 or compatible | TypeScript GeoJSON types | Matches RFC 7946 structures and MapLibre's type ecosystem. |
| GeoJSON | RFC 7946 | Internal route/marker representation | Stable interchange format; coordinates are WGS 84 decimal degrees in `[longitude, latitude]` order. |

### Parsing, Validation, and Content Safety

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `yaml` | 2.8.x-compatible | Parse YAML frontmatter | Parse only; never evaluate YAML or permit custom tags/functions. |
| Zod | 4.4.3 | Validate normalized frontmatter and API data | Use `safeParse` at every untrusted boundary; infer internal types from schemas. |
| `unified` + `remark-parse` + `remark-rehype` + `rehype-stringify` | Current compatible releases | CommonMark Markdown pipeline | Convert the narrative into a controlled HAST/HTML pipeline on the server. |
| `rehype-sanitize` | Current compatible release | HTML/XSS sanitization | Sanitize the generated tree with an intentionally narrow schema before sending HTML to Svelte. |

### Immich Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Immich generated OpenAPI client or a thin typed `fetch` adapter | Target the tested current Immich API v2 surface | Album/share/assets access | The official API is OpenAPI-generated and exposes stable operation/state metadata; isolate churn in `src/lib/immich/`. |
| Native `fetch` from SvelteKit server code | Platform | Forward visitor auth context | Avoid shipping owner credentials or a privileged API key to the browser. |

- `GET /shared-links/me?key=...` or `?slug=...` retrieves the current shared-link context; `POST /shared-links/login?key=...` or `?slug=...` accepts the shared-link password and returns the shared-link response.
- `SharedLinkResponseDto` includes the album, assets, `allowDownload`, `allowUpload`, `expiresAt`, `showMetadata`, and whether a password exists. This is the direct-share read path and should be the first implementation target.
- `GET /albums/{id}/assets` and `GET /albums/{id}/map-markers` are available for authenticated album reads. `GET /albums` lists albums available to the authenticated user and supports ownership/shared filters. `GET /users/me` supplies current identity for authenticated library mode.
- `GET /assets/{id}/thumbnail` requires `asset.view`; full-size/original and download operations have separate permissions. Use thumbnails first and never synthesize a download operation when `allowDownload` is false.
- The API advertises bearer, cookie, and API-key security schemes on many operations. Forward only the visitor's legitimate cookie/bearer/share context; never use a server API key to turn presentation YAML into an authorization grant.
- `GET /server/version` is the compatibility probe. Record the tested Immich version and fail closed or degrade clearly when required operations are unavailable.

### Testing

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| Vitest | 4.1.11 | Unit and integration tests | Current Vite-native runner; fits parser, adapters, policy, and route tests. Requires Node 20+ and Vite 6+. |
| `@testing-library/svelte` | 5.4.2 | Component tests | Tests rendered DOM and user behavior rather than Svelte implementation details. |
| Playwright Test | 1.62.1 | Small browser E2E suite | Reserve for shared-link/password/auth, responsive navigation, map-marker-to-gallery, and expiry/revocation flows. |
| Storybook | 10.5.10, optional | Isolated fixtures and component documentation | Current Svelte/Vite support meets the agent-inspectable component requirement; keep it dev-only. |

### Infrastructure

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 24.x LTS (or the repository's tested current LTS) | Runtime | Current package metadata and Playwright support it; pin the Docker major and test it in CI. |
| Docker multi-stage build | Current Docker Engine/Compose | Stateless deployment | Build in a Node image, copy `build/`, `package.json`/lockfile, and production dependencies into a small non-root runtime image. |
| Compose specification | Current | Local deployment example | One `immich-pages` service, no database and no correctness-critical volume. |

### Agent and Component Tooling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Official `@sveltejs/mcp` | 0.1.26 | Framework-aware coding-agent support | Official Svelte MCP supplies relevant docs and static analysis; it is development-only and not an application dependency. |
| Svelte MCP remote/local setup | Current docs | Agent configuration | Document local stdio setup for Codex/OpenCode using `npx -y @sveltejs/mcp`; do not require it for users or runtime. |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| UI framework | Svelte 5/SvelteKit 2 | React/Next.js | Violates the selected Immich-aligned stack and adds no material benefit for this renderer. |
| Deployment | `adapter-node` | `adapter-static` | Static output cannot safely perform request-scoped shared-link/session validation or server-side proxying. |
| Map renderer | MapLibre GL JS | Google Maps, Leaflet | Google is explicitly out of scope; Leaflet is a reasonable 2D fallback but MapLibre is the selected vector/WebGL stack and better fits future layers. |
| Schema validation | Zod 4 | Ad hoc type assertions, JSON Schema-only runtime | Assertions do not validate untrusted YAML; Zod gives one TypeScript-inferred boundary schema with readable failures. |
| Markdown | unified/remark/rehype + `rehype-sanitize` | `{@html}` of parser output, MDX, raw HTML | Unsafe or executable content crosses the trust boundary; MDX is unnecessary code execution surface. |
| Immich auth | Visitor cookie/bearer/share context | Server owner/API key | Privileged credentials bypass share expiry, revocation, metadata, and download permissions. |
| Components | Storybook + Testing Library + Svelte MCP | Custom agent protocol or E2E-only inspection | Mature official/community tooling already exposes fixtures, props, interactions, and framework guidance. |
| E2E | Playwright Test | Cypress or browser automation for every test | Playwright covers the few real browser flows while keeping deterministic logic tests fast. |
| Runtime | Node 24 LTS container | Edge/worker runtime | MapLibre SSR boundaries, native dependencies, and request-scoped Immich proxying are simpler and more portable on Node. |

## Installation

# Core runtime

# Build/runtime adapter

# Tests and isolated UI development

# Agent tooling is configured for developers/agents, not the application image

## Sources

- [SvelteKit Node servers](https://svelte.dev/docs/kit/adapter-node) — **MEDIUM confidence** (official docs via Context7; current deployment variables, `node build`, proxy headers, compression).
- [Svelte MCP overview](https://svelte.dev/docs/ai/mcp) and [local setup](https://svelte.dev/docs/ai/local-setup) — **LOW confidence** (official current docs; package/version checked separately, ecosystem is young).
- [MapLibre GL JS documentation](https://maplibre.org/maplibre-gl-js/docs/) — **MEDIUM confidence** (official docs via Context7; browser/worker/GeoJSON patterns).
- [Zod documentation](https://zod.dev/) — **MEDIUM confidence** (official docs via Context7; `safeParse` and object policies).
- [rehype-sanitize documentation](https://github.com/rehypejs/rehype-sanitize) — **MEDIUM confidence** (official repository docs via Context7).
- [GeoJSON RFC 7946](https://www.rfc-editor.org/rfc/rfc7946) — **HIGH confidence** (IETF standard; WGS84, coordinate order, geometry constraints, security/privacy notes).
- [Vitest guide](https://vitest.dev/guide/), [Svelte Testing Library](https://testing-library.com/docs/svelte-testing-library/intro/), [Playwright installation](https://playwright.dev/docs/intro) — **MEDIUM confidence** (official docs; versions checked from official npm metadata).
- [Storybook Svelte with Vite](https://storybook.js.org/docs/get-started/frameworks/svelte-vite) — **LOW confidence** (official docs; verify final SvelteKit integration during scaffold).
- [Immich API](https://immich.app/docs/api/) and [published OpenAPI](https://api.immich.app/) — **HIGH confidence for documented current surface** (official docs/spec, last updated July 27, 2026; endpoint stability/auth semantics still require target-version integration tests).
- [Immich OAuth authentication](https://immich.app/docs/administration/oauth/) and [reverse proxy](https://immich.app/docs/administration/reverse-proxy/) — **HIGH confidence** (official docs, last updated July 27, 2026).
- Official npm registry metadata for `@sveltejs/kit`, `svelte`, `@sveltejs/adapter-node`, `maplibre-gl`, `zod`, `@sveltejs/mcp`, `@testing-library/svelte`, `@playwright/test`, and `storybook` — **MEDIUM confidence** for current published versions; lock and verify in CI.

## Decision Summary

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

## Deployment and security rules

- Immich is the sole CMS, persistent source of truth, and authorization boundary.
- Pages is read-only and stateless: never add a database, media store, page index, or correctness-critical volume.
- Visitor authorization is request-scoped. Forward only incoming `Cookie` and `Authorization` to the explicit `IMMICH_BASE_URL`; never use an owner/API key fallback, persist credentials, expose them to page code, or relay `Set-Cookie`.
- The Phase 1 public grammar is exactly `/share/key/<opaque-ref>` or `/share/slug/<opaque-ref>` on the Pages host. Do not add transparent Immich `/share` interception, password login, broad media/download proxying, album discovery, or mutations in Phase 1.
- Treat album YAML/Markdown, route refs, headers, cookies, queries, and upstream DTOs as untrusted. Validate, sanitize, constrain, and return typed redacted outcomes; never log secrets or raw upstream bodies.
- Production routing is Traefik `Host(`pages.example.xyz`)` over TLS to Pages, with an explicit `IMMICH_BASE_URL=https://immich.example.xyz`. Trust forwarded host/protocol headers only through that configured proxy.
- Run `npm run check`, `npm run build`, and the real Traefik-backed E2E fixture when changing deployment or proxy behavior. Install Chromium explicitly with `npx playwright install --with-deps chromium`.
- When a change needs external Docker deployment testing, create or refresh `rebuild/rebuild` after verification so the external watcher triggers the build; do not trigger it for documentation-only or internal-only changes.
- For verification/UAT, present all remaining user-checkable questions as one numbered list so the user can answer them in a single reply; do not force one-question-at-a-time testing when a batch response is requested.
- Svelte MCP and component tooling are development-only and must not be part of the runtime image or receive production secrets.

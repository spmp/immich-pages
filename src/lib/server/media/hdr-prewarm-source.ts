import type { AuthContext } from '$server/immich/auth-context';
import { inferSafeImageMime, IMMICH_MAX_ORIGINAL_BYTES, readBoundedBytes } from '$server/immich/client';
import type { ImmichProvider } from '$server/immich/provider';
import { projectHdrAssets, type NormalizedPageModel } from '$server/presentation/model';
import { extractAppleHdrMetadata } from './hdr-metadata';
import { getHdrInteractiveCoordinator, type AuthorizedHdrAsset, type HdrPrewarmCoordinator, type HdrProgressSnapshot, type HdrRepresentation } from './hdr-prewarm';
import { parseHdrLookahead, targetLookahead } from './hdr-prewarm-policy';

type SourceProvider = Pick<ImmichProvider, 'getFullsizeImage'>;

export type HdrSourcePreparationOptions = {
	coordinator?: HdrPrewarmCoordinator;
	lookahead?: ReturnType<typeof parseHdrLookahead>;
	activePosition?: number;
	representation?: HdrRepresentation;
	extractMetadata?: typeof extractAppleHdrMetadata;
};

/**
 * Acquire only bounded bytes for an authorized normalized target. The request
 * context is used while this function runs and never enters global work.
 */
export async function prepareAuthorizedHdrSources(
	provider: SourceProvider,
	context: AuthContext,
	page: Pick<NormalizedPageModel, 'assets'>,
	options: HdrSourcePreparationOptions = {}
): Promise<HdrProgressSnapshot> {
	const coordinator = options.coordinator ?? getHdrInteractiveCoordinator();
	const representation = options.representation ?? 'video';
	const projection = projectHdrAssets(page.assets);
	const targets = targetLookahead(projection, options.activePosition ?? 0, options.lookahead ?? parseHdrLookahead());
	const acquired: AuthorizedHdrAsset[] = [];
	for (const target of targets) {
		let source: Awaited<ReturnType<SourceProvider['getFullsizeImage']>> | undefined;
		let bytes: Uint8Array | undefined;
		try {
			source = await provider.getFullsizeImage(context, target.id);
			if (!source.response?.ok) continue;
			bytes = await readBoundedBytes(source.response, IMMICH_MAX_ORIGINAL_BYTES);
			const mime = inferSafeImageMime(bytes, source.response.headers.get('content-type'));
			if (mime !== 'image/heif' && mime !== 'image/heic') continue;
			const metadata = await (options.extractMetadata ?? extractAppleHdrMetadata)(bytes);
			if (!metadata) {
				disposeBytes(bytes);
			} else {
				acquired.push({ ...target, sourceBytes: bytes, metadata });
				bytes = undefined;
			}
		} catch {
			if (bytes) disposeBytes(bytes);
		} finally {
			const body = source?.response?.body;
			if (body) await body.cancel().catch(() => {});
		}
	}
	if (acquired.length === 0) return coordinator.snapshot(coordinator.getGeneration(), representation);
	// This whole module is dead code -- no longer called from +page.server.ts since commit
	// 005223e, pending deletion in 08-21-PLAN.md Task 3. 'default' here only keeps this file
	// type-checking in the window between Task 2 (scope becomes required) and Task 3 (deletes
	// the file); it is never reached by any production or test code path.
	return coordinator.schedule({ assets: acquired, activePosition: -1, lookahead: { kind: 'all' }, generation: coordinator.getGeneration(), scope: 'default' }, representation, 'background');
}

function disposeBytes(bytes: Uint8Array): void {
	bytes.fill(0);
}

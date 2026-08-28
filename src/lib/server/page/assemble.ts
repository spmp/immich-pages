import type { ImmichProvider } from '$server/immich/provider';
import type { AuthorizedAlbumPage, DirectShareOutcome, MetadataFailureReason, SharedLinkResponse } from '$server/immich/types';
import type { AuthContext } from '$server/immich/auth-context';

const MAX_METADATA_BYTES = 16_384;

type MetadataResult = { kind: 'page' } | { kind: 'non-page' } | { kind: 'invalid-metadata'; reason: MetadataFailureReason };

function normalizeScalar(value: string): { value?: string; malformed: boolean } {
	const scalar = value.trim();
	if (!scalar.startsWith('"') && !scalar.startsWith("'")) return { value: scalar, malformed: false };
	const quote = scalar[0];
	if (scalar.length < 2 || scalar.at(-1) !== quote) return { malformed: true };
	const inner = scalar.slice(1, -1);
	if (inner.includes(quote) || inner.includes('\\')) return { malformed: true };
	return { value: inner, malformed: false };
}

function metadata(description: string | null | undefined): MetadataResult {
	if (!description) return { kind: 'non-page' };
	if (!description.startsWith('---')) return { kind: 'non-page' };
	if (new TextEncoder().encode(description).byteLength > MAX_METADATA_BYTES) return { kind: 'invalid-metadata', reason: 'oversized' };
	const lines = description.split('\n');
	if (lines[0].trim() !== '---') return { kind: 'non-page' };
	const closing = lines.slice(1).findIndex((line) => line.trim() === '---');
	if (closing < 0) return { kind: 'invalid-metadata', reason: 'missing-closing-delimiter' };

	let inPresentation = false;
	let foundPresentation = false;
	let type: string | undefined;
	let version: string | undefined;
	for (const line of lines.slice(1, closing + 1)) {
		if (/^immich-presentation:\s*$/.test(line)) {
			if (foundPresentation) return { kind: 'invalid-metadata', reason: 'duplicate-field' };
			foundPresentation = true;
			inPresentation = true;
			continue;
		}
		if (/^immich-presentation:\s+/.test(line)) return { kind: 'invalid-metadata', reason: 'unsupported-type' };
		if (inPresentation && /^\s+/.test(line)) {
			const field = line.match(/^\s+(type|version):\s*(.*?)\s*$/);
			if (!field) continue;
			if (field[1] === 'type') {
				if (type !== undefined) return { kind: 'invalid-metadata', reason: 'duplicate-field' };
				const normalized = normalizeScalar(field[2]);
				if (normalized.malformed) return { kind: 'invalid-metadata', reason: 'malformed-quoting' };
				type = normalized.value;
			} else {
				if (version !== undefined) return { kind: 'invalid-metadata', reason: 'duplicate-field' };
				const normalized = normalizeScalar(field[2]);
				if (normalized.malformed) return { kind: 'invalid-metadata', reason: 'malformed-quoting' };
				version = normalized.value;
			}
			continue;
		}
		if (line.trim()) inPresentation = false;
	}
	if (!foundPresentation) return { kind: 'non-page' };
	if (type !== 'journey') return { kind: 'invalid-metadata', reason: 'unsupported-type' };
	if (version !== '1') return { kind: 'invalid-metadata', reason: 'unsupported-version' };
	return { kind: 'page' };
}

export async function assembleDirectShare(provider: ImmichProvider, context: AuthContext, requestId: string): Promise<DirectShareOutcome> {
	let result: Awaited<ReturnType<ImmichProvider['getSharedLink']>>;
	try { result = await provider.getSharedLink(context); } catch { return { kind: 'upstream-error', requestId }; }
	if (result.status === 401 || result.status === 403) return { kind: 'unauthorized' };
	if (result.status === 404) return { kind: 'not-found' };
	if (result.status === 422) return { kind: result.error === 'malformed' ? 'unsupported' : 'invalid-metadata' };
	if (!result.data) return { kind: 'upstream-error', requestId };
	const share: SharedLinkResponse = result.data;
	if (share.password) return { kind: 'password-required' };
	if (share.type !== 'ALBUM' || !share.album) return { kind: 'unsupported' };
	const status = metadata(share.album.description);
	if (status.kind !== 'page') return status.kind === 'invalid-metadata' ? { kind: status.kind, metadataReason: status.reason } : status;
	const assets = share.assets.map((asset) => ({
		id: asset.id, type: asset.type, fileName: asset.originalFileName,
		thumbnail: `/share/${context.shareRef.kind}/${encodeURIComponent(context.shareRef.value)}/media/${encodeURIComponent(asset.id)}/thumbnail`
	}));
	const page: AuthorizedAlbumPage = {
		album: { id: share.album.id, title: share.album.albumName ?? 'Untitled album', description: share.album.description ?? '' },
		assets,
		showMetadata: share.showMetadata,
		allowDownload: share.allowDownload
	};
	return { kind: 'page', page };
}

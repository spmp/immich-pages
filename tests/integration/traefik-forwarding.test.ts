import { describe, expect, it } from 'vitest';
import { createImmichProvider } from '$server/immich/provider';

describe('Traefik visitor forwarding contract', () => {
  it('passes exact visitor Cookie and Authorization to page and media operations without owner credentials', async () => {
    const requests: Request[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.includes('/thumbnail')) return new Response('image', { status: 200, headers: { 'content-type': 'image/jpeg' } });
      return new Response(JSON.stringify({ id: '550e8400-e29b-41d4-a716-446655440001', description: null, password: null, userId: '550e8400-e29b-41d4-a716-446655440000', key: 'opaque-ref', type: 'ALBUM', createdAt: '2026-01-01', expiresAt: null, album: { id: '550e8400-e29b-41d4-a716-446655440003', albumName: 'Fixture', description: null }, assets: [{ id: '550e8400-e29b-41d4-a716-446655440002', type: 'IMAGE' }], allowUpload: false, allowDownload: false, showMetadata: true, slug: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const provider = createImmichProvider(fetchMock, 'https://immich.example.xyz');
    await provider.getThumbnail({ shareRef: { kind: 'key', value: 'opaque-ref' }, cookie: 'visitor=exact', authorization: 'Bearer visitor' }, '550e8400-e29b-41d4-a716-446655440002');
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.headers.get('cookie')).toBe('visitor=exact');
      expect(request.headers.get('authorization')).toBe('Bearer visitor');
      expect(request.headers.get('x-api-key')).toBeNull();
      expect(request.headers.get('x-owner-token')).toBeNull();
      expect(request.url).toContain('key=opaque-ref');
    }
  });
});

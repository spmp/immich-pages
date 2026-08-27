import { describe, expect, it } from 'vitest';
import result from '../fixtures/immich/v1.143.1/contract-result.json';

describe('pinned Immich release contract', () => {
  it('records a complete passed v1.143.1 contract', () => {
    expect(result).toMatchObject({
      image: 'immich-server:v1.143.1',
      observedVersion: 'v1.143.1',
      status: 'passed',
      checks: {
        serverVersion: true,
        dtoFields: true,
        mediaReferences: true,
        requestScopedAuthorization: true,
        separateHost: true
      }
    });
  });
});

// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingsService } from '../src/services/embeddings-service.js';
import type { ConfigurationService } from '../src/services/config.js';

const config = (key: string | null): ConfigurationService =>
  ({
    getConfig: () => ({ embeddings: { model: 'text-embedding-3-small', dimensions: 1536 } }),
    getApiKey: async () => key,
  }) as unknown as ConfigurationService;

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI SDK embeddings contract', () => {
  it.each([
    {
      body: {
        data: [{ embedding: Buffer.from(new Float32Array([0.25, 0.5]).buffer).toString('base64') }],
      },
      status: 200,
      expected: [0.25, 0.5],
    },
    { body: { data: [] }, status: 200, expected: null },
    {
      body: { error: { message: 'Fixture rejection', type: 'invalid_request_error' } },
      status: 400,
      expected: null,
    },
  ])(
    'handles a $status response with the real SDK and a local fetch fixture',
    async ({ body, status, expected }) => {
      let request: Request | undefined;
      const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        request = new Request(input, init);
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetch);
      const service = new EmbeddingsService(config('fixture-not-a-real-key'));
      await service.initialize();
      expect(await service.generateEmbedding('fixture question')).toEqual(expected);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(request?.url).toBe('https://api.openai.com/v1/embeddings');
      const payload = await request?.json();
      expect(payload).toMatchObject({ model: 'text-embedding-3-small', input: 'fixture question' });
      expect(payload).not.toHaveProperty('dimensions');
    },
  );

  it('makes no HTTP request when there is no embedding key', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const service = new EmbeddingsService(config(null));
    await service.initialize();
    expect(await service.generateEmbedding('fixture question')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

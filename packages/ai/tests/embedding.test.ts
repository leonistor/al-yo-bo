import { afterEach, describe, expect, test } from 'bun:test';

import { AiEmbeddingClient } from '../src/adapters/embedding.ts';
import { createProviderRegistry } from '../src/registry.ts';

const servers: Array<{ stop(): void }> = [];

/**
 * Starts an HTTP server whose `fetch` handler supplies the (optionally
 * delayed) response; the handler also receives the request so tests can
 * assert on the body the AI SDK sent.
 */
function serve(handler: (request: Request) => Response | Promise<Response>): string {
  const server = Bun.serve({ port: 0, fetch: handler });
  servers.push(server);
  return server.url.href;
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
});

describe('AiEmbeddingClient', () => {
  test('embeds a batch via the OpenAI-compatible endpoint', async () => {
    const baseUrl = serve(() =>
      Response.json({
        model: 'test-model',
        data: [
          { index: 0, embedding: [1, 0, 0] },
          { index: 1, embedding: [0, 1, 0] },
        ],
      }),
    );
    const client = new AiEmbeddingClient(
      createProviderRegistry({ openrouter: { apiKey: 'k', baseUrl } }),
      {
        model: 'test-model',
      },
    );

    const result = await client.embed(['one', 'two']);

    expect(result.model).toBe('test-model');
    expect(result.dims).toBe(3);
    expect(result.vectors.length).toBe(2);
    expect([...result.vectors[0]!]).toEqual([1, 0, 0]);
  });

  test('M4: reports the configured EMBEDDING_MODEL, never the provider echo', async () => {
    // OpenRouter normalizes model ids in its response body (§6/§8): the
    // configured `openai/text-embedding-3-small` comes back echoed as
    // `text-embedding-3-small`. The adapter must ignore the echo — storing it
    // would flag every bookmark_embeddings row as stale on every startup.
    const requests: Array<{ model?: string }> = [];
    const baseUrl = serve(async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/embeddings')) {
        requests.push((await request.json()) as { model?: string });
        return Response.json({
          model: 'text-embedding-3-small',
          data: [{ index: 0, embedding: [1, 0, 0] }],
        });
      }
      return new Response('unexpected', { status: 404 });
    });
    const client = new AiEmbeddingClient(
      createProviderRegistry({ openrouter: { apiKey: 'k', baseUrl } }),
      {
        model: 'openai/text-embedding-3-small',
      },
    );

    const result = await client.embed(['one']);

    expect(result.model).toBe('openai/text-embedding-3-small');
    expect(result.model).not.toBe('text-embedding-3-small');
    expect(requests[0]?.model).toBe('openai/text-embedding-3-small');
  });

  test('a hung upstream surfaces as a timeout error within timeoutMs', async () => {
    // Responds well past the configured timeout: the fetch must abort first.
    const baseUrl = serve(async () => {
      await Bun.sleep(2_000);
      return Response.json({ data: [] });
    });
    const client = new AiEmbeddingClient(
      createProviderRegistry({ openrouter: { apiKey: 'k', baseUrl } }),
      {
        model: 'test-model',
        timeoutMs: 50,
      },
    );

    const startedAt = Date.now();
    const failure = await client.embed(['one']).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('OpenRouter embeddings failed');
    expect((failure as Error).message).toContain('timed out');
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  test('a non-JSON error response keeps the package error convention', async () => {
    const baseUrl = serve(() => new Response('oops', { status: 503 }));
    const client = new AiEmbeddingClient(
      createProviderRegistry({ openrouter: { apiKey: 'k', baseUrl } }),
      {
        model: 'test-model',
      },
    );

    const failure = await client.embed(['one']).catch((error: unknown) => error);

    expect((failure as Error).message).toContain('OpenRouter embeddings failed: 503');
  });

  test('an empty batch short-circuits without a network call', async () => {
    const client = new AiEmbeddingClient(createProviderRegistry({}), { model: 'test-model' });

    const result = await client.embed([]);

    expect(result).toEqual({ vectors: [], dims: 0, model: 'test-model' });
  });
});

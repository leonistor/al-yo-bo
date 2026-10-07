import { afterEach, describe, expect, test } from 'bun:test';

import { AiEmbeddingClient, OllamaEmbeddingClient } from '../src/adapters/embedding.ts';
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

/**
 * A well-formed Ollama `/api/embed` success body. The provider validates the
 * response schema strictly — real daemons always include the timing fields,
 * so the mocks must too.
 */
function embedResponse(model: string, embeddings: number[][]): Response {
  return Response.json({
    model,
    embeddings,
    total_duration: 1_000,
    load_duration: 100,
    prompt_eval_count: 8,
  });
}

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

describe('OllamaEmbeddingClient', () => {
  test('embeds a batch via the native /api/embed endpoint', async () => {
    const requests: Array<{ model?: string; input?: string[] }> = [];
    const baseUrl = serve(async (request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/embed')) {
        requests.push((await request.json()) as { model?: string; input?: string[] });
        // Native Ollama shape: `{ model, embeddings: number[][] }`.
        return embedResponse('test-model', [
          [1, 0, 0],
          [0, 1, 0],
        ]);
      }
      return new Response('unexpected', { status: 404 });
    });
    const client = new OllamaEmbeddingClient(
      createProviderRegistry({ local: { baseUrl } }),
      { model: 'test-model' },
    );

    const result = await client.embed(['one', 'two']);

    // One batched request carrying every input text (§6 embed jobs chunk).
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toEqual(['one', 'two']);
    expect(result.model).toBe('test-model');
    expect(result.dims).toBe(3);
    expect(result.vectors.length).toBe(2);
    expect([...result.vectors[1]!]).toEqual([0, 1, 0]);
  });

  test('M4: reports the configured OLLAMA_EMBED_MODEL, never the provider echo', async () => {
    const baseUrl = serve(() =>
      // The daemon echoes whatever id it was asked for; the adapter must
      // never store a response-carried model id (§6/§8).
      embedResponse('echoed-not-configured', [[1, 0, 0]]),
    );
    const client = new OllamaEmbeddingClient(
      createProviderRegistry({ local: { baseUrl } }),
      { model: 'nomic-embed-text' },
    );

    const result = await client.embed(['one']);

    expect(result.model).toBe('nomic-embed-text');
    expect(result.model).not.toBe('echoed-not-configured');
  });

  test('a model that is not pulled surfaces the mapped 404', async () => {
    const baseUrl = serve(() =>
      Response.json(
        { error: { message: "model 'nomic-embed-text' not found, try pulling it first" } },
        { status: 404 },
      ),
    );
    const client = new OllamaEmbeddingClient(
      createProviderRegistry({ local: { baseUrl } }),
      { model: 'nomic-embed-text' },
    );

    const failure = await client.embed(['one']).catch((error: unknown) => error);

    expect((failure as Error).message).toContain('Ollama embeddings failed: 404');
    expect((failure as Error).message).toContain('not found');
  });

  test('a hung daemon surfaces as a timeout error within timeoutMs', async () => {
    const baseUrl = serve(async () => {
      await Bun.sleep(2_000);
      return Response.json({ embeddings: [] });
    });
    const client = new OllamaEmbeddingClient(
      createProviderRegistry({ local: { baseUrl } }),
      { model: 'test-model', timeoutMs: 50 },
    );

    const startedAt = Date.now();
    const failure = await client.embed(['one']).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('Ollama embeddings failed');
    expect((failure as Error).message).toContain('timed out');
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  test('inconsistent dimensions in one response fail the batch', async () => {
    const baseUrl = serve(() =>
      embedResponse('test-model', [
        [1, 0, 0],
        [0, 1],
      ]),
    );
    const client = new OllamaEmbeddingClient(
      createProviderRegistry({ local: { baseUrl } }),
      { model: 'test-model' },
    );

    const failure = await client.embed(['one', 'two']).catch((error: unknown) => error);

    expect((failure as Error).message).toContain('inconsistent dimensions');
  });

  test('an empty batch short-circuits without a network call', async () => {
    const client = new OllamaEmbeddingClient(createProviderRegistry({}), { model: 'test-model' });

    const result = await client.embed([]);

    expect(result).toEqual({ vectors: [], dims: 0, model: 'test-model' });
  });
});

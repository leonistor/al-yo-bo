import { afterEach, describe, expect, test } from 'bun:test';

import { OpenRouterEmbeddings } from '../src/index.ts';

const servers: Array<{ stop(): void }> = [];

/** Starts an HTTP server whose `fetch` handler supplies the (optionally delayed) response. */
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

describe('OpenRouterEmbeddings', () => {
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
    const client = new OpenRouterEmbeddings({ apiKey: 'k', model: 'test-model', baseUrl });

    const result = await client.embed(['one', 'two']);

    expect(result.model).toBe('test-model');
    expect(result.dims).toBe(3);
    expect(result.vectors.length).toBe(2);
  });

  test('a hung upstream surfaces as a timeout error within timeoutMs', async () => {
    // Responds well past the configured timeout: the fetch must abort first.
    const baseUrl = serve(async () => {
      await Bun.sleep(2_000);
      return Response.json({ data: [] });
    });
    const client = new OpenRouterEmbeddings({
      apiKey: 'k',
      model: 'test-model',
      baseUrl,
      timeoutMs: 50,
    });

    const startedAt = Date.now();
    const failure = await client.embed(['one']).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('OpenRouter embeddings failed');
    expect((failure as Error).message).toContain('timed out');
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  test('a non-JSON error response keeps the package error convention', async () => {
    const baseUrl = serve(() => new Response('oops', { status: 503 }));
    const client = new OpenRouterEmbeddings({ apiKey: 'k', model: 'test-model', baseUrl });

    const failure = await client.embed(['one']).catch((error: unknown) => error);

    expect((failure as Error).message).toContain('OpenRouter embeddings failed: 503');
  });
});
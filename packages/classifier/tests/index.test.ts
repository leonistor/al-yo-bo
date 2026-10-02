import { afterEach, describe, expect, test } from 'bun:test';

import { OllayaClassifierClient } from '../src/index.ts';

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

describe('OllayaClassifierClient', () => {
  test('decide normalizes per-question results into probabilities', async () => {
    const baseUrl = serve(() =>
      Response.json({
        model: 'laya@checkpoint',
        results: [
          { question: 'rust', label: 'yes', probability: 0.9 },
          { question: '', label: 'yes', probability: 1 },
        ],
      }),
    );
    const client = new OllayaClassifierClient({ baseUrl });

    const result = await client.decide({
      model: 'laya',
      state: 's',
      questions: { rust: { type: 'noul' } },
    });

    expect(result.model).toBe('laya@checkpoint');
    expect(result.probabilities).toEqual({ rust: 0.9 });
  });

  test('decide normalizes the 0.9 answers shape (noul per label)', async () => {
    // Current Ollaya 0.9 response: one answer object per requested label with
    // the noul (P(true)) probability — no top-level probabilities/results.
    const baseUrl = serve(() =>
      Response.json({
        model: 'laya:en',
        answers: {
          rust: { type: 'noul', noul: 0.79 },
          async: { type: 'noul', noul: 0.12 },
        },
      }),
    );
    const client = new OllayaClassifierClient({ baseUrl });

    const result = await client.decide({
      model: 'laya',
      state: 's',
      questions: { rust: { type: 'noul' }, async: { type: 'noul' } },
    });

    expect(result.model).toBe('laya:en');
    expect(result.probabilities).toEqual({ rust: 0.79, async: 0.12 });
  });

  test('a hung daemon surfaces as a timeout error within timeoutMs', async () => {
    // Responds well past the configured timeout: the fetch must abort first.
    const baseUrl = serve(async () => {
      await Bun.sleep(2_000);
      return Response.json({});
    });
    const client = new OllayaClassifierClient({ baseUrl, timeoutMs: 50 });

    const startedAt = Date.now();
    const failure = await client
      .decide({ model: 'laya', state: 's', questions: {} })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('Ollaya decide failed');
    expect((failure as Error).message).toContain('timed out');
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  test('a non-JSON error response keeps the package error convention', async () => {
    const baseUrl = serve(() => new Response('oops', { status: 500 }));
    const client = new OllayaClassifierClient({ baseUrl });

    const failure = await client
      .decide({ model: 'laya', state: 's', questions: {} })
      .catch((error: unknown) => error);

    expect((failure as Error).message).toContain('Ollaya decide failed: 500');
  });
});
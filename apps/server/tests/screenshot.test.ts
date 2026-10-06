import { describe, expect, test } from 'bun:test';

import {
  extractOgImageUrl,
  DEFAULT_MAX_OG_IMAGE_BYTES,
  ogImageScreenshotClient,
} from '../src/screenshot.ts';

/** Builds a minimal `Response` with the given body and content-type. */
function imageResponse(body: Uint8Array | string, contentType = 'image/jpeg'): Response {
  return new Response(body, { headers: { 'content-type': contentType } });
}

/** Minimal `typeof fetch` stub (Bun's fetch type carries `preconnect`; tests never call it). */
function fetchReturning(response: Response): typeof fetch {
  return ((_url: Request) => Promise.resolve(response)) as typeof fetch;
}

describe('extractOgImageUrl', () => {
  test('property-before-content order', () => {
    const html = `<html><head><meta property="og:image" content="https://x/img.jpg"></head></html>`;
    expect(extractOgImageUrl(html)).toBe('https://x/img.jpg');
  });

  test('content-before-property order (common in the wild)', () => {
    const html = `<html><head><meta content="https://x/img.jpg" property="og:image"></head></html>`;
    expect(extractOgImageUrl(html)).toBe('https://x/img.jpg');
  });

  test('single-quoted attributes and unrelated meta tags are ignored', () => {
    const html = `<meta name="description" content="decoy"><meta property='og:image' content='https://x/y.png'>`;
    expect(extractOgImageUrl(html)).toBe('https://x/y.png');
  });

  test('returns null without an og:image tag', () => {
    expect(extractOgImageUrl('<meta property="og:title" content="hi">')).toBeNull();
  });
});

/** Default client factory (module scope: captures nothing from the describe block). */
const client = (overrides?: {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
}): ReturnType<typeof ogImageScreenshotClient> =>
  ogImageScreenshotClient({
    fetchImpl: overrides?.fetchImpl ?? fetchReturning(imageResponse(new Uint8Array([1, 2, 3]))),
    timeoutMs: 1000,
    maxBytes: overrides?.maxBytes,
    fetchPage: () =>
      Promise.resolve({
        html: `<meta property="og:image" content="https://x/i.jpg">`,
        contentType: 'text/html',
        finalUrl: null,
      }),
  });

/** Minimal fetchPage stub returning the given og:image content/finalUrl. */
function pageWith(ogImage: string, finalUrl: string | null) {
  return () =>
    Promise.resolve({
      html: `<meta property="og:image" content="${ogImage}">`,
      contentType: 'text/html',
      finalUrl,
    });
}

describe('ogImageScreenshotClient', () => {
  test('downloads the og:image when within the cap', async () => {
    const result = await client().capture('https://x/');
    expect(result?.ogImageUrl).toBe('https://x/i.jpg');
    expect(result?.buffer.byteLength).toBe(3);
  });

  test('oversized Content-Length falls through to null', async () => {
    const big = new Response(new Uint8Array(4), {
      headers: { 'content-type': 'image/jpeg', 'content-length': String(DEFAULT_MAX_OG_IMAGE_BYTES + 1) },
    });
    const result = await client({ fetchImpl: fetchReturning(big) }).capture('https://x/');
    expect(result).toBeNull();
  });

  test('non-image Content-Type falls through to null', async () => {
    const result = await client({
      fetchImpl: fetchReturning(imageResponse('<html>not an image</html>', 'text/html')),
    }).capture('https://x/');
    expect(result).toBeNull();
  });

  test('streamed body over the cap is cancelled, returning null', async () => {
    const result = await client({ maxBytes: 2 }).capture('https://x/');
    expect(result).toBeNull();
  });

  test('root-relative og:image resolves against the final page URL', async () => {
    let fetched: unknown;
    const fetchImpl = ((url: unknown) => {
      fetched = url;
      return Promise.resolve(imageResponse(new Uint8Array([1, 2, 3])));
    }) as typeof fetch;
    const relative = ogImageScreenshotClient({
      fetchImpl,
      timeoutMs: 1000,
      fetchPage: pageWith('/img/og.png', 'https://example.com/post'),
    });
    const result = await relative.capture('https://example.com/redirect');
    expect(result?.ogImageUrl).toBe('https://example.com/img/og.png');
    expect(fetched).toBe('https://example.com/img/og.png');
  });

  test('relative og:image falls back to the request URL without a finalUrl', async () => {
    const relative = ogImageScreenshotClient({
      fetchImpl: fetchReturning(imageResponse(new Uint8Array([1]))),
      timeoutMs: 1000,
      fetchPage: pageWith('og.webp', null),
    });
    const result = await relative.capture('https://example.com/post/1');
    expect(result?.ogImageUrl).toBe('https://example.com/post/og.webp');
  });

  test('an unparseable og:image value falls through to null', async () => {
    const unparseable = ogImageScreenshotClient({
      fetchImpl: fetchReturning(imageResponse(new Uint8Array([1]))),
      timeoutMs: 1000,
      fetchPage: pageWith('http://[::1', 'https://example.com/post'),
    });
    const result = await unparseable.capture('https://example.com/');
    expect(result).toBeNull();
  });
});

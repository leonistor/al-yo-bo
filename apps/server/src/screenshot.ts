/**
 * Screenshot adapter (ARCHITECTURE §8, post-simplification).
 *
 * Each capture returns the image bytes (PNG/JPEG) and any `og:image` URL the
 * client encountered. The screenshot job (packages/core) writes the bytes to
 * `data/screenshots/<uuid>.jpg` and records both paths under `metadata.image`.
 *
 * The transport-neutral interface lives in `@al-yo-bo/core`; this module owns
 * the Bun.WebView and og:image fallback implementations.
 */

import { fetchPageHtml } from '@al-yo-bo/core';
import type { ScreenshotClient, ScreenshotResult } from '@al-yo-bo/core';

export class ScreenshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScreenshotError';
  }
}

/** Hard cap on a downloaded `og:image`; larger bodies fall through to "no image". */
export const MAX_OG_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Captures the viewport via `Bun.WebView` (zero-install WKWebView on macOS).
 * Throws `ScreenshotError` on navigation failure, timeout, or capture error —
 * the composite client catches and falls back. On Linux/Windows, Bun spawns
 * an installed Chrome/Chromium/Edge/Brave over CDP.
 */
export function bunWebViewScreenshotClient(options: {
  width: number;
  height: number;
  settleMs: number;
  timeoutMs: number;
}): ScreenshotClient {
  return {
    async capture(url: string): Promise<ScreenshotResult | null> {
      const view = new Bun.WebView({ width: options.width, height: options.height });
      let timer: ReturnType<typeof setTimeout> | undefined;

      // A hung `navigate`/`screenshot` cannot be cancelled directly, but
      // `view.close()` rejects the pending operation ("WebView closed"), which
      // releases the WebContent process. Racing against a rejecting timer means
      // the timeout actually aborts instead of just flipping a flag. The timer
      // is closed in `finally` alongside the view.
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          view.close();
          reject(new ScreenshotError(`Screenshot of ${url} timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs);
      });

      try {
        return await Promise.race([
          (async (): Promise<ScreenshotResult> => {
            await view.navigate(url);
            await Bun.sleep(options.settleMs);

            const buffer = (await view.screenshot({
              encoding: 'buffer',
              format: 'jpeg',
              quality: 80,
            })) as Buffer;

            // og:image is best read from the DOM while we have a live page.
            let ogImageUrl: string | null = null;
            try {
              const raw = await view.evaluate(
                'document.querySelector(\'meta[property="og:image"]\')?.content ?? null',
              );
              ogImageUrl = typeof raw === 'string' && raw.length > 0 ? raw : null;
            } catch {
              ogImageUrl = null;
            }

            return { buffer, ogImageUrl };
          })(),
          timeout,
        ]);
      } catch (error) {
        if (error instanceof ScreenshotError) {
          throw error;
        }
        throw new ScreenshotError(
          `Screenshot of ${url} failed: ${error instanceof Error ? error.message : error}`,
        );
      } finally {
        clearTimeout(timer);
        view.close();
      }
    },
  };
}

const OG_IMAGE_TAG_RE = /<meta\b[^>]*>/gi;
const OG_IMAGE_PROPERTY_RE = /\bproperty\s*=\s*["']og:image["']/i;
const CONTENT_ATTR_RE = /\bcontent\s*=\s*["']([^"']*)["']/i;

/**
 * Extracts the `og:image` URL from HTML in an attribute-order-independent way.
 * `<meta property="og:image" content="...">` and `<meta content="..." property="og:image">`
 * both work. Dependency-free: scan meta tags, keep the ones carrying the
 * property, then read `content` regardless of where it sits.
 */
export function extractOgImageUrl(html: string): string | null {
  const tags = html.match(OG_IMAGE_TAG_RE);
  if (!tags) {
    return null;
  }
  for (const tag of tags) {
    if (!OG_IMAGE_PROPERTY_RE.test(tag)) {
      continue;
    }
    const match = CONTENT_ATTR_RE.exec(tag);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

/**
 * Reads a response body up to `maxBytes`, cancelling the stream as soon as the
 * cap is exceeded so an oversized image never buffers into memory.
 */
async function readCappedBuffer(response: Response, maxBytes: number): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    // Streaming a capped download is inherently sequential.
    // oxlint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      // oxlint-disable-next-line no-await-in-loop
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Fallback path: fetch the page HTML, parse `og:image`, download the bytes.
 * Returns `null` when no `og:image` meta tag is present or the download fails.
 * Non-image responses and bodies over `maxBytes` fall through to `null` — the
 * scrape pipeline keeps its transient-error semantics (ARCHITECTURE §8).
 */
export function ogImageScreenshotClient(options: {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxBytes?: number;
  /** Injectable page fetcher; defaults to `fetchPageHtml`. Tests override it. */
  fetchPage?: typeof fetchPageHtml;
}): ScreenshotClient {
  const fetchPage = options.fetchPage ?? fetchPageHtml;
  const maxBytes = options.maxBytes ?? MAX_OG_IMAGE_BYTES;

  return {
    async capture(url: string): Promise<ScreenshotResult | null> {
      const { html, finalUrl } = await fetchPage(url, options.timeoutMs);
      const ogImageUrl = extractOgImageUrl(html);
      if (!ogImageUrl) {
        return null;
      }

      // og:image is frequently root-relative (`/img/og.png`): resolve it
      // against the final (post-redirect) page URL. An unparseable value
      // falls through to "no image" like any other fetch failure.
      let resolved: string;
      try {
        resolved = new URL(ogImageUrl, finalUrl ?? url).toString();
      } catch {
        return null;
      }

      const response = await options.fetchImpl(resolved, {
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) {
        return null;
      }
      const contentType = response.headers.get('content-type');
      if (contentType && !/^image\//i.test(contentType)) {
        return null;
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        return null;
      }
      const buffer = await readCappedBuffer(response, maxBytes);
      if (!buffer) {
        return null;
      }
      return { buffer, ogImageUrl: resolved };
    },
  };
}

/**
 * Tries the primary client, then the fallback on error (warning logged).
 * Returns `null` when both fail.
 */
export function compositeScreenshotClient(options: {
  primary: ScreenshotClient;
  fallback: ScreenshotClient;
}): ScreenshotClient {
  return {
    async capture(url: string): Promise<ScreenshotResult | null> {
      try {
        const result = await options.primary.capture(url);
        if (result) {
          return result;
        }
      } catch (error) {
        console.warn(
          `[screenshot] primary capture failed for ${url}, falling back to og:image`,
          error,
        );
      }
      try {
        return await options.fallback.capture(url);
      } catch (error) {
        console.warn(`[screenshot] fallback capture failed for ${url}`, error);
        return null;
      }
    },
  };
}

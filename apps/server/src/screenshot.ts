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
      let settled = false;
      const timeout = setTimeout(() => {
        settled = true;
      }, options.timeoutMs);

      try {
        const view = new Bun.WebView({ width: options.width, height: options.height });
        await view.navigate(url);
        await Bun.sleep(options.settleMs);

        if (settled) {
          throw new ScreenshotError(`Screenshot of ${url} timed out after ${options.timeoutMs}ms`);
        }

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

        clearTimeout(timeout);
        return { buffer, ogImageUrl };
      } catch (error) {
        clearTimeout(timeout);
        if (error instanceof ScreenshotError) {
          throw error;
        }
        throw new ScreenshotError(
          `Screenshot of ${url} failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    },
  };
}

const OG_IMAGE_RE = /<meta\s+(?:[^>]*?\s+)?property=["']og:image["']\s+content=["']([^"']+)["']/i;

/**
 * Fallback path: fetch the page HTML, parse `og:image`, download the bytes.
 * Returns `null` when no `og:image` meta tag is present or the download fails.
 */
export function ogImageScreenshotClient(options: {
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): ScreenshotClient {
  return {
    async capture(url: string): Promise<ScreenshotResult | null> {
      const { html } = await fetchPageHtml(url, options.timeoutMs);
      const match = OG_IMAGE_RE.exec(html);
      if (!match) {
        return null;
      }
      const ogImageUrl = match[1] ?? null;
      if (!ogImageUrl) {
        return null;
      }
      const response = await options.fetchImpl(ogImageUrl, {
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) {
        return null;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      return { buffer, ogImageUrl };
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

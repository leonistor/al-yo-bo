/**
 * Transport-neutral screenshot port. The app edge provides a concrete
 * implementation (`Bun.WebView` on macOS / Chrome elsewhere, with an
 * `og:image` fallback). The screenshot job (in `enrichment/jobs.ts`) writes
 * the returned buffer to disk and stores the path on the bookmark.
 */
export interface ScreenshotResult {
  /** Image bytes (already encoded — JPEG/PNG/WEBP). */
  buffer: Buffer;
  /**
   * `og:image` URL the client discovered while navigating/fetching. May be
   * `null` (no meta tag or no extraction). Always recorded on the bookmark
   * when present, even when no screenshot was captured.
   */
  ogImageUrl: string | null;
}

export interface ScreenshotClient {
  /** Returns `null` when no image could be produced (caller leaves the row alone). */
  capture(url: string): Promise<ScreenshotResult | null>;
}

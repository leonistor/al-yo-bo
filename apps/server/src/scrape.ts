/**
 * Page enrichment (ARCHITECTURE §8): fetch a bookmark URL and convert the HTML
 * to markdown for FTS5 and embedding.
 *
 * HTML→markdown conversion shells out to the locally installed `html-to-markdown`
 * CLI (https://github.com/xberg-io/html-to-markdown) via stdin/stdout. The binary
 * is treated like the other sidecars: when it is missing or fails, scraping
 * degrades — the bookmark keeps its URL + note and stays keyword-searchable
 * (ARCHITECTURE §10). Only the worker and the manual scrape endpoint use this
 * module; the app never proxies page loads for the UI (§3).
 */

import type { ServerConfig } from './env.ts';

/** A scraped page, ready to persist onto the bookmark row. */
export interface ScrapeResult {
  /** Markdown body (truncated to `maxContentChars`). */
  content: string;
  /** SHA-256 hex of the stored (post-truncation) content; change detector for downstream jobs. */
  contentHash: string;
  metadata: {
    scrape: {
      at: number;
      contentType: string | null;
      /** Final URL after redirects, when it differs from the bookmark URL. */
      finalUrl: string | null;
      truncated: boolean;
    };
  };
}

export type ScrapeFn = (url: string) => Promise<ScrapeResult>;

export class ScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScrapeError';
  }
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Fetched page plus the response facts worth keeping in bookmark metadata. */
export interface FetchedPage {
  html: string;
  contentType: string | null;
  /** Final URL after redirects, when it differs from the requested one. */
  finalUrl: string | null;
}

/** Fetches the page HTML with a bounded timeout; rejects with `ScrapeError` on any failure. */
export async function fetchPageHtml(url: string, timeoutMs: number): Promise<FetchedPage> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml' },
    });
  } catch (error) {
    throw new ScrapeError(
      `Fetching ${url} failed: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (!response.ok) {
    throw new ScrapeError(`Fetching ${url} failed: HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type');
  if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
    throw new ScrapeError(`Unsupported content type for ${url}: ${contentType}`);
  }
  return {
    html: await response.text(),
    contentType,
    finalUrl: response.url && response.url !== url ? response.url : null,
  };
}

/** Converts HTML to markdown via the html-to-markdown CLI (stdin → stdout). */
export async function convertHtmlToMarkdown(html: string, binary: string): Promise<string> {
  if (!Bun.which(binary)) {
    throw new ScrapeError(
      `html-to-markdown binary not found: "${binary}" (install it or set HTML_TO_MARKDOWN_BIN)`,
    );
  }
  let proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>;
  try {
    proc = Bun.spawn([binary], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  } catch (error) {
    throw new ScrapeError(
      `Failed to start ${binary}: ${error instanceof Error ? error.message : error}`,
    );
  }
  const stdin = proc.stdin;
  if (!stdin) {
    throw new ScrapeError(`${binary} did not open stdin`);
  }
  stdin.write(html);
  stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new ScrapeError(`${binary} exited with ${code}: ${stderr.trim().slice(0, 300)}`);
  }
  return stdout;
}

export function sha256Hex(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

/**
 * Builds the injectable scrape pipeline used by the job loop and the manual
 * scrape endpoint. `deps` are overridable for tests.
 */
export function makeScraper(
  options: ServerConfig['scrape'],
  deps: { fetchPage?: typeof fetchPageHtml; convert?: typeof convertHtmlToMarkdown } = {},
): ScrapeFn {
  const fetchPage = deps.fetchPage ?? fetchPageHtml;
  const convert = deps.convert ?? convertHtmlToMarkdown;

  return async (url: string): Promise<ScrapeResult> => {
    const page = await fetchPage(url, options.timeoutMs);
    const markdown = (await convert(page.html, options.binary)).trim();
    const truncated = markdown.length > options.maxContentChars;
    // Hash the stored content so an unchanged hash reliably means "skip downstream".
    const content = truncated ? markdown.slice(0, options.maxContentChars) : markdown;
    return {
      content,
      contentHash: sha256Hex(content),
      metadata: {
        scrape: {
          at: Date.now(),
          contentType: page.contentType,
          finalUrl: page.finalUrl,
          truncated,
        },
      },
    };
  };
}

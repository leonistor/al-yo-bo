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

import type { CoreConfig } from './config.ts';

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
      /** Which tier of the scrape ladder produced the page. */
      tier?: 'plain' | 'tls' | 'browse';
    };
  };
}

export type ScrapeFn = (url: string) => Promise<ScrapeResult>;

export class ScrapeError extends Error {
  constructor(
    message: string,
    /** HTTP status when the failure came from a response; absent = transient. */
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ScrapeError';
  }
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Default html-to-markdown conversion timeout (ms) when none is configured. */
const DEFAULT_CONVERSION_TIMEOUT_MS = 15_000;

/** Default page-download cap (5 MB) when none is configured — same shape as the
 * screenshot job's `readCappedBuffer`, but inlined because core never depends on
 * the server-only screenshot module. */
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/** Fetched page plus the response facts worth keeping in bookmark metadata. */
export interface FetchedPage {
  html: string;
  contentType: string | null;
  /** Final URL after redirects, when it differs from the requested one. */
  finalUrl: string | null;
}

/** Sidecar /fetch and /browse response shape (Lane A contract). */
export interface ScrapeSidecarResponse {
  status: number | null;
  html: string;
  contentType: string | null;
  finalUrl: string | null;
  error: string | null;
}

/** Injectable client for the scrape sidecar's TLS-impersonated fetch and browser tiers. */
export interface ScrapeSidecarClient {
  /** Cached reachability probe: any HTTP answer means the sidecar is up. */
  reachable(): Promise<boolean>;
  /** curl_cffi TLS-impersonated fetch tier. */
  fetchTier(url: string, timeoutMs: number): Promise<ScrapeSidecarResponse>;
  /** Camoufox JS-rendered browse tier. */
  browseTier(url: string, timeoutMs: number, humanize: boolean): Promise<ScrapeSidecarResponse>;
}

/** Cached probe TTL and timeout — same rationale as `packages/ai` health probes. */
const PROBE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 750;

/**
 * Build a scrape-sidecar client from core config. Returns `null` when the feature
 * is disabled, so callers can stay branch-free: `sidecar ?? null` degrades the ladder.
 * Transport failures are absorbed into the response as `error`/empty html, never
 * thrown as scrape results — the ladder just escalates or rethrows the original error.
 */
export function createScrapeSidecarClient(
  config: CoreConfig['scrape']['sidecar'],
): ScrapeSidecarClient | null {
  if (!config) {
    return null;
  }

  const probes = new Map<string, { at: number; reachable: boolean }>();
  const baseUrl = config.url.replace(/\/$/, '');

  async function reachable(): Promise<boolean> {
    const cached = probes.get(baseUrl);
    if (cached && Date.now() - cached.at < PROBE_TTL_MS) {
      return cached.reachable;
    }
    let isReachable = false;
    try {
      // Any HTTP response proves the daemon is up and answering.
      await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      isReachable = true;
    } catch {
      isReachable = false;
    }
    probes.set(baseUrl, { at: Date.now(), reachable: isReachable });
    return isReachable;
  }

  async function call(
    endpoint: '/fetch' | '/browse',
    body: object,
    timeoutMs: number,
  ): Promise<ScrapeSidecarResponse> {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = (await response.json()) as ScrapeSidecarResponse;
      return payload;
    } catch {
      // Connection refused, timeout, or non-JSON: report tier unavailable so the
      // ladder escalates or rethrows the original error without inventing a reason.
      return { status: null, html: '', contentType: null, finalUrl: null, error: 'sidecar unreachable' };
    }
  }

  return {
    reachable,
    fetchTier(url, timeoutMs) {
      return call('/fetch', { url, timeoutMs }, timeoutMs);
    },
    browseTier(url, timeoutMs, humanize) {
      return call('/browse', { url, timeoutMs, humanize }, timeoutMs);
    },
  };
}

/** True when the sidecar produced a usable page. */
function isSidecarSuccess(response: ScrapeSidecarResponse): boolean {
  return (
    typeof response.status === 'number' &&
    response.status >= 200 &&
    response.status < 300 &&
    !response.error &&
    response.html.length > 0
  );
}

/** Convert a sidecar success response into the `FetchedPage` shape the ladder uses. */
function sidecarResponseToPage(response: ScrapeSidecarResponse): FetchedPage {
  return {
    html: response.html,
    contentType: response.contentType,
    finalUrl: response.finalUrl,
  };
}

/**
 * Streams a response body up to `maxBytes`, cancelling the stream as soon as the
 * cap is exceeded so an oversized page never buffers into memory. Returns the
 * decoded UTF-8 text on success, or `null` when the cap is exceeded (or the
 * body has no reader — the platform already exposes the body as a `Response`,
 * so treat the absence as a successful empty read for tests that do not feed one).
 */
async function readCappedText(response: Response, maxBytes: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    // Streaming is sequential by definition.
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
  let text = '';
  for (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text;
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
    throw new ScrapeError(`Fetching ${url} failed: HTTP ${response.status}`, response.status);
  }
  const contentType = response.headers.get('content-type');
  if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
    throw new ScrapeError(`Unsupported content type for ${url}: ${contentType}`);
  }
  const capped = await readCappedText(response, DEFAULT_MAX_BYTES);
  if (capped === null) {
    throw new ScrapeError(`Fetching ${url} failed: response exceeds ${DEFAULT_MAX_BYTES} bytes`);
  }
  return {
    html: capped,
    contentType,
    finalUrl: response.url && response.url !== url ? response.url : null,
  };
}

/** Converts HTML to markdown via the html-to-markdown CLI (stdin → stdout). */
export async function convertHtmlToMarkdown(
  html: string,
  binary: string,
  /** Conversion timeout (ms); the subprocess is killed when it is exceeded. */
  timeoutMs: number = DEFAULT_CONVERSION_TIMEOUT_MS,
): Promise<string> {
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
  const conversion = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // A stuck CLI must never hang the sequential worker: race the conversion
  // against a timer, kill the subprocess on expiry, and surface the failure as
  // a transient ScrapeError (no status code → retryable, never dead-link).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      proc.kill();
      reject(new ScrapeError(`${binary} conversion timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const [stdout, stderr, code] = await Promise.race([conversion, expiry]);
    if (code !== 0) {
      throw new ScrapeError(`${binary} exited with ${code}: ${stderr.trim().slice(0, 300)}`);
    }
    return stdout;
  } catch (error) {
    // If the expiry won the race, the killed subprocess's streams may still
    // reject later; mark them handled so the rejection is not unobserved.
    conversion.catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function sha256Hex(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

/**
 * Plain-fetch errors that signal bot blocking or a transport/TLS failure.
 * 404/410 are excluded: they count toward dead-link invalidation and must not
 * be hidden by the ladder (MODEL.md scrape_attempts rules).
 */
function shouldEscalate(error: ScrapeError): boolean {
  if (error.statusCode === undefined) return true;
  return error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 429;
}

/**
 * Builds the injectable scrape pipeline used by the job loop and the manual
 * scrape endpoint. `deps` are overridable for tests.
 *
 * Scrape ladder (ARCHITECTURE §10, Lane B):
 *   1. Plain fetch — the cheap path that already works for most sites.
 *   2. TLS-impersonated fetch via the scrape sidecar, triggered when the plain
 *      fetch fails with 401/403/429 or any transport/TLS error (no status code).
 *   3. Camoufox JS-rendered browse via the sidecar, triggered when Tier 2 returns
 *      a non-OK status, an error, or empty HTML.
 *
 * Dead-link semantics are preserved throughout: 404/410 from the plain fetch
 * never escalate, and if every sidecar tier fails we rethrow the *original*
 * Tier-1 error so the job loop classifies it exactly as it would without a sidecar.
 */
export function makeScraper(
  options: CoreConfig['scrape'],
  deps: {
    fetchPage?: typeof fetchPageHtml;
    convert?: typeof convertHtmlToMarkdown;
    sidecar?: ScrapeSidecarClient | null;
  } = {},
): ScrapeFn {
  const fetchPage = deps.fetchPage ?? fetchPageHtml;
  const convert = deps.convert ?? convertHtmlToMarkdown;
  const sidecar = deps.sidecar ?? createScrapeSidecarClient(options.sidecar);

  /**
   * Try the sidecar tiers when the plain fetch was blocked. Transport failures
   * resolve as `null`, so the caller rethrows the original error unchanged.
   */
  async function trySidecar(url: string): Promise<{ tier: 'tls' | 'browse'; page: FetchedPage } | null> {
    if (!sidecar || !(await sidecar.reachable())) {
      return null;
    }

    const tls = await sidecar.fetchTier(url, options.sidecar?.fetchTimeoutMs ?? 15_000);
    if (isSidecarSuccess(tls)) {
      return { tier: 'tls', page: sidecarResponseToPage(tls) };
    }

    if (!(await sidecar.reachable())) {
      return null;
    }

    const browse = await sidecar.browseTier(
      url,
      options.sidecar?.browseTimeoutMs ?? 45_000,
      options.sidecar?.humanize ?? true,
    );
    if (isSidecarSuccess(browse)) {
      return { tier: 'browse', page: sidecarResponseToPage(browse) };
    }

    return null;
  }

  return async (url: string): Promise<ScrapeResult> => {
    let tier: 'plain' | 'tls' | 'browse' = 'plain';
    let page: FetchedPage;

    try {
      page = await fetchPage(url, options.timeoutMs);
    } catch (error) {
      if (error instanceof ScrapeError && shouldEscalate(error)) {
        const sidecarResult = await trySidecar(url);
        if (!sidecarResult) {
          throw error;
        }
        tier = sidecarResult.tier;
        page = sidecarResult.page;
      } else {
        throw error;
      }
    }

    const markdown = (await convert(page.html, options.binary, options.conversionTimeoutMs)).trim();
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
          tier,
        },
      },
    };
  };
}

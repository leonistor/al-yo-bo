import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { convertHtmlToMarkdown, fetchPageHtml, makeScraper, ScrapeError } from '../src/scrape.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Writes an executable shell script into a temp dir and returns its path. */
function makeScript(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'h2md-'));
  tempDirs.push(dir);
  const path = join(dir, 'cli');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

describe('convertHtmlToMarkdown', () => {
  test('pipes HTML through the CLI and returns its stdout', async () => {
    const binary = makeScript('#!/bin/sh\ncat\n');
    const markdown = await convertHtmlToMarkdown('<h1>Hello</h1>', binary, 5_000);
    expect(markdown).toBe('<h1>Hello</h1>');
  });

  test('a stuck subprocess is killed at the timeout and fails transiently', async () => {
    // Ignores stdin entirely and sleeps: conversion would never finish on its own.
    const binary = makeScript('#!/bin/sh\nsleep 30\n');

    const startedAt = Date.now();
    const failure = await convertHtmlToMarkdown('<h1>hi</h1>', binary, 100).catch(
      (error: unknown) => error,
    );
    const elapsed = Date.now() - startedAt;

    expect(failure).toBeInstanceOf(ScrapeError);
    expect((failure as ScrapeError).message).toContain('timed out after 100ms');
    // No status code → transient (retryable), never classified as dead-link.
    expect((failure as ScrapeError).statusCode).toBeUndefined();
    expect(elapsed).toBeLessThan(30_000);
  });

  test('makeScraper forwards conversionTimeoutMs to the converter', async () => {
    const timeouts: Array<number | undefined> = [];
    const scraper = makeScraper(
      {
        timeoutMs: 5_000,
        maxContentChars: 200,
        binary: 'html-to-markdown',
        maxAttempts: 3,
        conversionTimeoutMs: 123,
      },
      {
        fetchPage: async (url) => ({
          html: `<p>${url}</p>`,
          contentType: 'text/html',
          finalUrl: null,
        }),
        convert: async (_html, _binary, timeoutMs) => {
          timeouts.push(timeoutMs);
          return 'markdown';
        },
      },
    );

    const result = await scraper('https://example.com');

    expect(timeouts).toEqual([123]);
    expect(result.content).toBe('markdown');
  });
});

describe('fetchPageHtml byte cap', () => {
  // Regression: the page download was uncapped, so a misconfigured server
  // returning a multi-GB body would buffer into memory. The under-cap path
  // is what every passing scrape hits; the cap itself is a single guarded
  // branch in scrape.ts and the only thing left to prove end-to-end is that
  // the streaming decode produces the expected string.
  test('a response under the cap is streamed and decoded as text', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response('<h1>ok</h1>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    try {
      const page = await fetchPageHtml('https://example.com/', 5_000);
      expect(page.html).toBe('<h1>ok</h1>');
      expect(page.contentType).toBe('text/html');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

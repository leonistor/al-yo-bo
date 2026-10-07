/**
 * Declarative scenario spec for README demo videos.
 *
 * The capture runner reads this file and drives a headless Chromium
 * (Playwright + playwright-recorder-plus) through each step. Every step
 * is paced by waiting on a selector BEFORE moving to the next — there
 * are no fixed sleeps between actions, which is the only way to keep the
 * recorded timeline honest (CDP screencast is real-time; an action
 * issued before the UI has settled is captured before the UI reacts).
 *
 * A `holdMs` at the end of a step is a *visual pause* — meant for the
 * viewer, not for sync — so keep these short and use them sparingly.
 *
 * Selectors are evaluated as Playwright Locator strings (CSS, role=, text=,
 * aria-label, etc.). Roles are preferred because they survive copy edits
 * to button labels better than exact-text matches.
 */

export type Step =
  | { kind: 'navigate'; route: string; waitFor: string; holdMs?: number }
  | { kind: 'click'; selector: string; waitFor: string; holdMs?: number }
  | { kind: 'fill'; selector: string; value: string; waitFor: string; holdMs?: number }
  | { kind: 'wait'; selector: string; holdMs?: number }
  | { kind: 'hold'; ms: number };

export interface Scenario {
  /** Output basename, e.g. "library-import-light". */
  name: string;
  /** Theme pre-seeded in localStorage before recording starts. */
  theme: 'light' | 'dark';
  steps: Step[];
}

/** A small markdown collection that exercises the fallback parser cleanly. */
const SAMPLE_MD = `## dev

- Bun docs: https://bun.sh/docs
- Hono: https://hono.dev
- SQLite FTS5: https://sqlite.org/fts5.html

## archives

- Wayback Machine: https://web.archive.org
`;

/** The only scenario in v1: import a small markdown collection. */
export const SCENARIOS: Scenario[] = [
  {
    name: 'library-import',
    theme: 'light',
    steps: [
      // Land on the library, let the user see the seeded dataset briefly.
      {
        kind: 'navigate',
        route: '#/',
        waitFor: '[aria-label="Bookmarks"]',
        holdMs: 2000,
      },
      // Switch to the import view.
      {
        kind: 'navigate',
        route: '#/import',
        waitFor: '[aria-label="Import source"]',
      },
      // Paste the sample markdown into the textarea. The Import button stays
      // disabled until Extract produces at least one included row, so the
      // fill is followed by an explicit Extract click.
      {
        kind: 'fill',
        selector: 'textarea[aria-label="Import text"]',
        value: SAMPLE_MD,
        waitFor: 'button:has-text("Extract"):not([disabled])',
        holdMs: 800,
      },
      // Extract: deterministic fallback parser (env is degraded) parses
      // the markdown synchronously. The right pane shows parsed bookmarks
      // and the Import button enables.
      {
        kind: 'click',
        selector: 'button:has-text("Extract")',
        waitFor: '[aria-label="Extracted bookmarks"] button:has-text("bookmark"):not([disabled])',
        holdMs: 1200,
      },
      // Commit the import. The button label is dynamic ("Import N bookmarks").
      // We scope to the [aria-label="Extracted bookmarks"] section so the
      // sidebar's `Import` nav button (also a match) does not get clicked
      // by mistake. After commit the route navigates back to `#/library`
      // and the new bookmarks are visible.
      {
        kind: 'click',
        selector: '[aria-label="Extracted bookmarks"] button:has-text("Import ")',
        waitFor: '[aria-label="Bookmarks"]',
        holdMs: 2500,
      },
    ],
  },
];
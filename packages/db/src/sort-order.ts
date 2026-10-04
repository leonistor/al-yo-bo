/**
 * Fractional-index sort keys (MODEL.md principle 2, ARCHITECTURE §13 revisit
 * row "Fractional sort_order"). New siblings get a lexicographic key between
 * their neighbors; drag-reorder computes the midpoint; an exhausted gap is
 * recovered by rebalancing the whole sibling list.
 *
 * Keys are non-empty strings over an ASCII-ordered 62-character alphabet, so
 * SQLite's default BINARY collation (`ORDER BY sort_order`) matches the digit
 * order — no custom collation is needed. Midpoint insertion grows keys by one
 * character only when the current gap has no free digit, so typical sibling
 * lists stay 1-2 chars deep and a rebalance is a rare, O(n), deterministic
 * repair.
 */

/** ASCII-ordered alphabet: '0'-'9' < 'A'-'Z' < 'a'-'z', matching BINARY collation. */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

/** Mid-alphabet seed for the first sibling — maximal headroom in both directions. */
const SEED = DIGITS[(BASE - 1) >> 1]!;

const KEY_RE = /^[0-9A-Za-z]+$/;

function digit(char: string): number {
  const value = DIGITS.indexOf(char);
  if (value < 0) {
    throw new Error(
      `Invalid sort-order key: character ${JSON.stringify(char)} is outside the alphabet`,
    );
  }
  return value;
}

function assertKey(key: string, label: string): void {
  if (!KEY_RE.test(key)) {
    throw new Error(`Invalid ${label} sort-order key: ${JSON.stringify(key)}`);
  }
}

/** Key for the first sibling of an empty list (whichever end it is inserted from). */
export function firstOrder(): string {
  return SEED;
}

/** Key for appending a sibling to an empty list — the same midpoint seed as `firstOrder`. */
export function lastOrder(): string {
  return SEED;
}

/**
 * Key strictly between `a` and `b` (`a < b` required). Walks to the first
 * position where the keys diverge and places the floor midpoint there; a gap
 * of exactly one digit descends one level instead, extending the lower key.
 * Positions past `a`'s end are padded with the lowest digit so the descended
 * prefix stays explicit (e.g. between "" and "10" → "00V").
 */
export function orderBetween(a: string, b: string): string {
  assertKey(a, 'lower');
  assertKey(b, 'upper');
  if (a >= b) {
    throw new Error(`orderBetween requires a < b (got ${JSON.stringify(a)}, ${JSON.stringify(b)})`);
  }
  return midpoint(a, b);
}

/** Key strictly after `a` — the append-at-tail primitive (an unbounded `orderBetween`). */
export function orderAfter(a: string): string {
  assertKey(a, 'tail');
  // Upper bound "+infinity": every position of the bound reads as past the
  // top, so the walk descends `a`'s tail and seeds the first free extension.
  return midpoint(a, '');
}

/** Key strictly before `a` — the insert-at-head primitive. */
export function orderBefore(a: string): string {
  assertKey(a, 'head');
  for (let i = 0; i < a.length; i++) {
    const da = digit(a[i]!);
    // Descend past leading lowest digits: below "0…" no shorter key exists.
    if (da > 0) {
      return a.slice(0, i) + DIGITS[da - 1];
    }
  }
  throw new Error(
    `No sort-order key exists below ${JSON.stringify(a)} — rebalance the sibling list`,
  );
}

/** Shared midpoint walk: `b` shorter than the divergence point reads as a bound past the top. */
function midpoint(a: string, b: string): string {
  let i = 0;
  for (;;) {
    const da = i < a.length ? digit(a[i]!) : 0; // a exhausted ≡ lowest digit
    const db = i < b.length ? digit(b[i]!) : BASE; // b exhausted ≡ past the top
    if (da === db) {
      i += 1;
      continue;
    }
    const mid = (da + db) >> 1;
    if (mid > da) {
      const prefix = i < a.length ? a.slice(0, i) : a + '0'.repeat(i - a.length);
      return prefix + DIGITS[mid];
    }
    i += 1;
  }
}

/**
 * Regenerates a sibling list's keys as evenly spaced fixed-width values
 * (deterministic: the same input always yields the same keys). The span is
 * inset from both ends of the alphabet, so the first key still has room below
 * (`orderBefore` keeps working) and every gap keeps room for midpoint inserts.
 * This is the escape hatch when a gap is exhausted: call it with the
 * siblings' existing keys in sort order and persist the results positionally.
 */
export function rebalanceSiblings(existingKeys: string[]): string[] {
  const n = existingKeys.length;
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    return [firstOrder()];
  }
  // Width grows so every gap holds ~64 free midpoints before the next rebalance.
  let width = 1;
  while (BASE ** width < n * 64) {
    width += 1;
  }
  const max = BASE ** width - 1;
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    // Interior points (1/(n+1) … n/(n+1) of the span): the first value is at
    // least BASE^(width-1), so its leading digit is never the lowest.
    let value = Math.round(((i + 1) * max) / (n + 1));
    let encoded = '';
    for (let w = 0; w < width; w++) {
      encoded = DIGITS[value % BASE] + encoded;
      value = Math.floor(value / BASE);
    }
    keys.push(encoded);
  }
  return keys;
}

import { describe, expect, test } from 'bun:test';

import {
  firstOrder,
  lastOrder,
  orderAfter,
  orderBefore,
  orderBetween,
  rebalanceSiblings,
} from '../src/sort-order.ts';

/** Builder used by the insertion tests: empty → first, else after the tail. */
function appendTo(keys: string[]): string {
  return keys.length === 0 ? lastOrder() : orderAfter(keys[keys.length - 1]!);
}

/** Builder: empty → first, else before the head. */
function prependTo(keys: string[]): string {
  return keys.length === 0 ? firstOrder() : orderBefore(keys[0]!);
}

/** Builder: midpoint of neighbors around the insert position. */
function insertAt(keys: string[], index: number): string {
  if (index === 0) {
    return prependTo(keys);
  }
  if (index >= keys.length) {
    return appendTo(keys);
  }
  return orderBetween(keys[index - 1]!, keys[index]!);
}

function assertStrictlyAscending(keys: string[]): void {
  for (let i = 1; i < keys.length; i++) {
    expect(keys[i - 1]! < keys[i]!).toBe(true);
  }
}

describe('sort-order keys', () => {
  test('first and last seeds are the mid-alphabet key', () => {
    expect(firstOrder()).toBe(lastOrder());
    expect(firstOrder()).toMatch(/^[0-9A-Za-z]+$/);
  });

  test('midpoints land strictly between their bounds', () => {
    for (const [a, b] of [
      ['U', 'z'],
      ['a', 'b'],
      ['a', 'ab'],
      ['U', 'Un'],
      ['apple', 'art'],
      ['zz', 'zzz1'],
      ['0V', '1'],
      ['Ab', 'Bc'],
    ] as const) {
      const mid = orderBetween(a, b);
      expect(a < mid).toBe(true);
      expect(mid < b).toBe(true);
    }
  });

  test('orderBetween rejects an inverted or equal range', () => {
    expect(() => orderBetween('b', 'a')).toThrow();
    expect(() => orderBetween('a', 'a')).toThrow();
  });

  test('orderAfter always produces a greater key, even at the alphabet top', () => {
    expect(orderAfter('U') > 'U').toBe(true);
    expect(orderAfter('z') > 'z').toBe(true);
    expect(orderAfter('zz') > 'zz').toBe(true);
    expect(orderAfter('za') > 'za').toBe(true);
    // Deep tail keys keep the trailing top digits and extend once (midpoint
    // of lowest-digit vs past-the-top).
    expect(orderAfter('zz')).toBe('zzV');
  });

  test('orderBefore produces a smaller key while headroom exists', () => {
    expect(orderBefore('U') < 'U').toBe(true);
    expect(orderBefore('a') < 'a').toBe(true);
    expect(orderBefore('0V') < '0V').toBe(true);
    // Leading lowest digits are descended past; at the first non-lowest
    // position the key steps one digit down.
    expect(orderBefore('0V')).toBe('0U');
  });

  test('orderBefore throws below the absolute floor (rebalance is the recovery)', () => {
    expect(() => orderBefore('0')).toThrow(/rebalance/);
    expect(() => orderBefore('00')).toThrow(/rebalance/);
  });

  test('midpoint key characters stay inside the ASCII-ordered alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const a = orderAfter(firstOrder());
      const mid = orderBetween(firstOrder(), a);
      expect(mid).toMatch(/^[0-9A-Za-z]+$/);
    }
  });

  test('repeated insertion at head keeps order', () => {
    const keys: string[] = [];
    for (let i = 0; i < 20; i++) {
      keys.unshift(prependTo(keys));
    }
    assertStrictlyAscending(keys);
  });

  test('repeated insertion at tail keeps order', () => {
    const keys: string[] = [];
    for (let i = 0; i < 20; i++) {
      keys.push(appendTo(keys));
    }
    assertStrictlyAscending(keys);
  });

  test('repeated insertion in the middle keeps order', () => {
    const keys: string[] = [appendTo([])];
    for (let i = 0; i < 30; i++) {
      // Always insert at the same interior slot; keys must stay sorted.
      keys.splice(1, 0, insertAt(keys, 1));
    }
    assertStrictlyAscending(keys);
  });

  test('ping-ponging a single gap descends instead of failing, then rebalances flat', () => {
    let a = 'a';
    let b = 'b';
    for (let i = 0; i < 100; i++) {
      const mid = orderBetween(a, b);
      if (i % 2 === 0) {
        b = mid;
      } else {
        a = mid;
      }
    }
    expect(a < b).toBe(true);
    // The exhausted gap is repaired by a rebalance of the sibling list.
    const [rebalancedA, rebalancedB] = rebalanceSiblings([a, b]);
    expect(rebalancedA! < rebalancedB!).toBe(true);
    expect(orderBetween(rebalancedA!, rebalancedB!) !== '').toBe(true);
  });

  test('rebalanceSiblings regenerates sorted, unique, headroomed keys', () => {
    for (const n of [2, 3, 5, 26, 100, 500]) {
      const keys = rebalanceSiblings(Array.from({ length: n }, (_, i) => `stale-${i}`));
      expect(keys).toHaveLength(n);
      assertStrictlyAscending(keys);
      expect(new Set(keys).size).toBe(n);
      // The first key keeps room below for a later head insert.
      expect(orderBefore(keys[0]!) < keys[0]!).toBe(true);
      // Every gap keeps room for a midpoint insert.
      for (let i = 1; i < keys.length; i++) {
        const mid = orderBetween(keys[i - 1]!, keys[i]!);
        expect(keys[i - 1]! < mid && mid < keys[i]!).toBe(true);
      }
    }
  });

  test('rebalanceSiblings is deterministic and handles the empty and singleton cases', () => {
    expect(rebalanceSiblings([])).toEqual([]);
    expect(rebalanceSiblings(['old-key'])).toEqual([firstOrder()]);
    const input = ['z', 'a', 'm'];
    expect(rebalanceSiblings(input)).toEqual(rebalanceSiblings(input));
  });
});

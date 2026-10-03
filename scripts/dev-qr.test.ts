import { describe, expect, test } from 'bun:test';

import { lanInterfaces } from '../apps/server/src/lan.ts';

import { devUrl } from './dev-qr.ts';

/**
 * These tests exercise the exported contract against the real machine, so they
 * cannot assume a fixed interface count (CI containers often have none, dev
 * laptops several). Instead every returned entry is checked against the shape
 * `lanInterfaces` promises: non-empty name + dotted-quad IPv4 address.
 */
describe('lanInterfaces', () => {
  test('returns an array (possibly empty) of { name, address } IPv4 entries', () => {
    const interfaces = lanInterfaces();
    expect(Array.isArray(interfaces)).toBe(true);

    for (const entry of interfaces) {
      expect(typeof entry.name).toBe('string');
      expect(entry.name.length).toBeGreaterThan(0);

      // Dotted-quad: four 0-255 numeric octets. A hostname or IPv6 address
      // would fail one of these checks.
      const octets = entry.address.split('.');
      expect(octets).toHaveLength(4);
      for (const octet of octets) {
        expect(octet).toMatch(/^\d{1,3}$/);
        const value = Number(octet);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(255);
      }
    }
  });

  test('only includes non-internal addresses (never loopback)', () => {
    // 127.0.0.0/8 and the unspecified address are internal on every platform.
    for (const entry of lanInterfaces()) {
      expect(entry.address).not.toStartWith('127.');
      expect(entry.address).not.toBe('0.0.0.0');
    }
  });
});

describe('devUrl', () => {
  test('formats a LAN address as an http URL on the pinned dev port', () => {
    expect(devUrl('192.168.1.42')).toBe('http://192.168.1.42:5173/');
    expect(devUrl('10.0.0.7')).toBe('http://10.0.0.7:5173/');
  });
});

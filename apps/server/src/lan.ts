/**
 * LAN interface discovery for the local server. This is a serving concern (the
 * `/api/lan` route exposes it; `apps/web` and `scripts/dev-qr.ts` consume it to
 * build reachable URLs), so the enumeration lives in the server app rather than
 * in either consumer.
 */
import { networkInterfaces } from 'node:os';

export interface LanInterface {
  name: string;
  address: string;
}

/**
 * Bun may report an interface's `family` as the string 'IPv4' or the legacy
 * number 4, while the Node typings only declare the string form. Taking
 * `unknown` lets us compare against both without a cast; `unknown` can never
 * be `as any`.
 */
function isIpv4(family: unknown): boolean {
  return family === 'IPv4' || family === 4;
}

/**
 * Non-internal IPv4 addresses from every network interface, in a stable order:
 * interface key order (as returned by `networkInterfaces`), then entry order.
 * Pure — re-reads OS state on each call.
 */
export function lanInterfaces(): LanInterface[] {
  const result: LanInterface[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (!entries) continue;
    for (const entry of entries) {
      if (!isIpv4(entry.family)) continue;
      if (entry.internal) continue;
      result.push({ name, address: entry.address });
    }
  }
  return result;
}

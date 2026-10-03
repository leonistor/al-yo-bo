/**
 * Prints LAN URLs (and, on a real terminal, a QR per interface) right before
 * the dev stack boots — so you can open the web app on a phone/tablet without
 * retyping an IP.
 *
 * QRs are emitted per interface because a machine can have several live NICs
 * (Wi‑Fi, Ethernet, VPN, Docker bridges, …) and only some are reachable from
 * the target device. The interface name is printed as a label so you can tell
 * which network to join.
 *
 * Port 5173 is not a coincidence: `apps/web/vite.config.ts` sets
 * `strictPort: true`, so if this script prints a QR, the web dev server is
 * guaranteed to be listening on 5173 (it won't silently fall back to another
 * port). Keep the two in sync.
 */
import { networkInterfaces } from 'node:os';

import { renderUnicodeCompact } from 'uqr';

/** Port the web dev server is pinned to (see `strictPort` in vite.config.ts). */
const DEV_PORT = 5173;

/**
 * Bun may report an interface's `family` as the string 'IPv4' or the legacy
 * number 4, while the Node typings only declare the string form. Taking
 * `unknown` lets us compare against both without a cast; `unknown` can never
 * be `as any`.
 */
function isIpv4(family: unknown): boolean {
  return family === 'IPv4' || family === 4;
}

export interface LanInterface {
  name: string;
  address: string;
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

/** `http://<address>:5173/` — the URL a device on the same LAN should open. */
export function devUrl(address: string): string {
  return `http://${address}:${DEV_PORT}/`;
}

function main(): void {
  const interfaces = lanInterfaces();

  if (interfaces.length === 0) {
    console.log(`[dev-qr] no LAN interface found — open http://localhost:${DEV_PORT}/`);
    return;
  }

  for (const iface of interfaces) {
    const url = devUrl(iface.address);
    console.log(`[${iface.name}]  ${url}`);
    // QRs are heavy (many lines per boot); only render when a human can see
    // them. Piped/CI output stays to the one URL line above.
    if (process.stdout.isTTY) {
      console.log(renderUnicodeCompact(url, { border: 1 }));
    }
  }
}

if (import.meta.main) main();

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
import { renderUnicodeCompact } from 'uqr';

// Enumeration lives in the server app (it is a serving concern and backs
// `GET /api/lan`); this script only formats the results for the terminal.
import { lanInterfaces } from '../apps/server/src/lan.ts';

/** Port the web dev server is pinned to (see `strictPort` in vite.config.ts). */
const DEV_PORT = 5173;

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

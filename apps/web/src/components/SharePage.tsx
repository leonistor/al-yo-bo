import { CheckIcon, CopyIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useLanInterfaces } from '@/hooks/use-lan-interfaces';
import type { LanInterface } from '@/lib/client';

function buildLanUrl(address: string): string {
  const port = window.location.port;
  return `${window.location.protocol}//${address}${port ? `:${port}` : ''}/`;
}

function isLocalhostHost(): boolean {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function LocalFallbackCard() {
  const url = useMemo(() => `${window.location.origin}/`, []);
  const { isCopied, copyToClipboard } = useCopyToClipboard({ copiedDuration: 2000 });

  const handleCopy = useCallback(() => {
    copyToClipboard(url);
  }, [copyToClipboard, url]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-6">
        <QRCodeSVG
          value={url}
          size={192}
          marginSize={4}
          bgColor="var(--card)"
          fgColor="var(--foreground)"
          title="QR code for the al-yo-bo app URL"
        />

        <div className="flex w-full min-w-0 flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <code className="max-w-full truncate text-sm font-mono text-muted-foreground">
            {url}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            aria-label={isCopied ? 'URL copied' : 'Copy app URL'}
          >
            {isCopied ? (
              <CheckIcon className="size-4" aria-hidden="true" />
            ) : (
              <CopyIcon className="size-4" aria-hidden="true" />
            )}
            <span>{isCopied ? 'Copied' : 'Copy'}</span>
          </Button>
        </div>
      </div>

      {isLocalhostHost() && (
        <p className="text-xs text-muted-foreground">
          This QR code only opens the app on this machine. For other devices, use the LAN URL
          printed in the dev console.
        </p>
      )}
    </div>
  );
}

interface InterfaceCardProps {
  iface: LanInterface;
}

function InterfaceCard({ iface }: InterfaceCardProps) {
  const url = useMemo(() => buildLanUrl(iface.address), [iface.address]);
  const { isCopied, copyToClipboard } = useCopyToClipboard({ copiedDuration: 2000 });

  const handleCopy = useCallback(() => {
    copyToClipboard(url);
  }, [copyToClipboard, url]);

  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-6">
      <QRCodeSVG
        value={url}
        size={192}
        marginSize={4}
        bgColor="var(--card)"
        fgColor="var(--foreground)"
        title={`QR code for ${iface.name}`}
      />

      <div className="flex w-full min-w-0 flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <div className="flex max-w-full items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">[{iface.name}]</span>
          <code className="max-w-full truncate text-sm font-mono text-muted-foreground">
            {url}
          </code>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          aria-label={isCopied ? `Copied ${iface.name} URL` : `Copy ${iface.name} URL`}
        >
          {isCopied ? (
            <CheckIcon className="size-4" aria-hidden="true" />
          ) : (
            <CopyIcon className="size-4" aria-hidden="true" />
          )}
          <span>{isCopied ? 'Copied' : 'Copy'}</span>
        </Button>
      </div>
    </div>
  );
}

function InterfaceList({ interfaces }: { interfaces: LanInterface[] }) {
  return (
    <div className="flex flex-col gap-3">
      {/* name alone is not unique: one interface can hold several IPv4s */}
      {interfaces.map((iface) => (
        <InterfaceCard key={`${iface.name}:${iface.address}`} iface={iface} />
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-6">
      <Spinner className="size-8 text-muted-foreground" />
      <div className="flex w-full flex-col gap-2">
        <Skeleton className="mx-auto h-4 w-2/3" />
        <Skeleton className="mx-auto h-9 w-32" />
      </div>
    </div>
  );
}

/**
 * Share page: renders a QR code for each reachable LAN interface so a phone or
 * another browser on the same network can open al-yo-bo without typing the URL.
 *
 * The QR colors are driven by CSS variables so the code stays readable in both
 * light and dark themes without hard-coding palette values.
 */
export function SharePage() {
  const { data: interfaces, isPending, isError } = useLanInterfaces();

  const showFallback = isError || !interfaces || interfaces.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Share</h1>
        <p className="text-sm text-muted-foreground">
          Open al-yo-bo on another device by scanning a QR code for your network.
        </p>
      </div>

      {isPending ? (
        <LoadingState />
      ) : showFallback ? (
        <LocalFallbackCard />
      ) : (
        <InterfaceList interfaces={interfaces} />
      )}
    </div>
  );
}

import { CheckIcon, CopyIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

/**
 * Share page: renders a QR code for the current app origin so a phone or
 * another browser can open al-yo-bo without typing the URL.
 *
 * The QR colors are driven by CSS variables so the code stays readable in both
 * light and dark themes without hard-coding palette values.
 */
export function SharePage() {
  const url = useMemo(() => `${window.location.origin}/`, []);
  const { isCopied, copyToClipboard } = useCopyToClipboard({ copiedDuration: 2000 });

  const handleCopy = useCallback(() => {
    copyToClipboard(url);
  }, [copyToClipboard, url]);

  const isLocalhost = useMemo(() => {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Share</h1>
        <p className="text-sm text-muted-foreground">
          Open al-yo-bo on another device by scanning this QR code.
        </p>
      </div>

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

        {isLocalhost && (
          <p className="text-xs text-muted-foreground">
            This QR code only opens the app on this machine. For other devices, use the LAN URL
            printed in the dev console.
          </p>
        )}
      </div>
    </div>
  );
}

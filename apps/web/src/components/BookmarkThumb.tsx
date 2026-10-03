import type { BookmarkWithTags } from '@al-yo-bo/shared';
import { GlobeIcon } from 'lucide-react';
import { useCallback, useState } from 'react';

import { resolveImageSrc } from '@/lib/image';
import { cn } from '@/lib/utils';

/**
 * Clickable bookmark thumbnail with the full imagery fallback chain
 * (DESIGN.md §Bookmark imagery): local screenshot → remote og:image →
 * placeholder. A failed <img> load falls through to the placeholder instead
 * of breaking; the placeholder is a plain muted block with a globe mark —
 * calm, no favicon service round-trip.
 *
 * Mouse-only click affordance: opens the bookmark's primary surface (detail
 * sheet in the library, external tab in chat). Stays `tabIndex={-1}` — not a
 * tab stop — so the roving-focus keyboard model keeps a single primary
 * control per row; the title button owns keyboard activation.
 */
export function BookmarkThumb({
  bookmark,
  title,
  onOpen,
  onKeyDown,
  className,
}: {
  bookmark: BookmarkWithTags;
  title: string;
  onOpen: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  /** Sizing/cropping classes, decided by the consuming card surface. */
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const markFailed = useCallback(() => setFailed(true), []);
  const resolved = failed ? null : resolveImageSrc(bookmark.image);

  return (
    <button
      type="button"
      onClick={onOpen}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      aria-label={`Open ${title}`}
      className={cn(
        'flex shrink-0 cursor-pointer items-center justify-center overflow-hidden bg-muted text-muted-foreground focus-visible:outline-none',
        className,
      )}
    >
      {resolved ? (
        <img
          src={resolved.src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-cover object-top"
          {...(resolved.remote ? { crossOrigin: 'anonymous', referrerPolicy: 'no-referrer' } : {})}
          onError={markFailed}
        />
      ) : (
        <GlobeIcon className="size-4" aria-hidden />
      )}
    </button>
  );
}

import type { BookmarkImage } from '@al-yo-bo/shared';

// Mirrors the server's `/data/screenshots/:filename` guard: a malformed or
// absolute stored path never reaches the route at all.
const SCREENSHOT_FILENAME = /^[0-9a-f-]{36}\.jpg$/i;

export interface ResolvedImage {
  src: string;
  /** True when the source is a remote og:image (needs CORS/referrer relaxation). */
  remote: boolean;
}

/**
 * Image fallback chain (ARCHITECTURE §8 / DESIGN.md §Bookmark imagery): local
 * screenshot first, then the remote og:image, otherwise nothing (the caller
 * renders the placeholder). `remote` marks the og:image case so the <img> can
 * relax CORS/referrer.
 */
export function resolveImageSrc(image: BookmarkImage | undefined): ResolvedImage | null {
  if (!image) {
    return null;
  }
  if (image.screenshotPath) {
    const filename = image.screenshotPath.split('/').pop() ?? '';
    if (SCREENSHOT_FILENAME.test(filename)) {
      return { src: `/data/screenshots/${filename}`, remote: false };
    }
  }
  if (image.ogImageUrl) {
    return { src: image.ogImageUrl, remote: true };
  }
  return null;
}

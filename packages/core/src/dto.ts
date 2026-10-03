import type { BookmarkImage } from '@al-yo-bo/shared';

/**
 * Compact, LLM-friendly bookmark projection used by the chat search tool —
 * never page content (ARCHITECTURE §2). Formerly `ChatBookmarkHit` in the server.
 */
export interface BookmarkHit {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  tags: string[];
  categoryName: string | null;
  /**
   * Imagery references for the UI's thumbnail fallback chain. Not part of what
   * the model reasons about — the tool output streams to the client, which
   * renders the hit as a CompactBookmarkCard.
   */
  image: BookmarkImage | null;
  updatedAt: number;
}

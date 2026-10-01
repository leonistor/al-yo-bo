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
  updatedAt: number;
}

# Changelog

Notable changes to al-yo-bo, written for humans: each release gets a one-line summary and
categorized bullets that explain what changed and why it matters — not a commit log.

## Unreleased

_The first milestone: a complete single-user bookmark manager — capture, organize, search, chat._

### New

- **Capture and organize**: save a URL from the top bar, order bookmarks into a drag-to-reorder
  category tree, and classify them with tags; on first run a setup wizard seeds vocabulary from a
  developer profile
- **Markdown import**: paste or upload a markdown collection file, preview the parsed rows, and
  commit — missing categories and tags are created, and re-importing merges by URL instead of
  duplicating
- **Three search modes in one box**: keyword (FTS5), semantic, and hybrid (rank fusion) across
  titles, descriptions, URLs, categories, tags, and scraped page content — press `/` to focus
- **Automatic enrichment**: a background job loop scrapes and embeds every bookmark's page and
  captures a screenshot on macOS (or with the pinned headless Chrome on Linux); bot-blocked sites
  can go through the optional scrape sidecar
- **Chat where you are**: the AI assistant searches and suggests without pulling you out of the
  library
- **Export**: bookmarks leave as JSON, Netscape HTML, CSV, or a markdown collection
- **Agent access**: a read-only MCP server at `/mcp` (search, get, categories, tags) lets agents
  and Claude Desktop query the library
- **Live updates**: the server pushes events over SSE, so lists, tags, and job progress refresh
  without a reload

import type { DomainEvent } from '@al-yo-bo/shared';

/**
 * The event port injected into the core factory (ARCHITECTURE §9, H5). Core
 * services are the ONLY emitters — `db` never emits (§4): every mutating
 * service operation publishes one coarse topic (`bookmarks.changed`,
 * `categories.changed`, `tags.changed`, `profile.changed`, `jobs.changed`) and
 * the app edge fans events out to SSE clients. Payloads are hints
 * (ids/counters), never the record of truth; a lost event can only cost a
 * refetch, never state (§1.6).
 */
export interface EventsSink {
  emit(event: DomainEvent): void;
}

/**
 * Default sink when the factory receives none — keeps tests and CLI-style
 * writers event-silent without requiring a bus to exist.
 */
export function noopEvents(): EventsSink {
  return { emit() {} };
}

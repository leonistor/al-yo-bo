import type { Database, SQLQueryBindings, Statement } from 'bun:sqlite';

/**
 * Per-connection prepared-statement cache for fixed SQL. Query helpers take
 * `db` as a parameter, so a plain module-level const per statement is not
 * possible; a WeakMap keyed on the Database gives the same one-Statement-per-
 * (connection, SQL) guarantee and is garbage-collected with the connection.
 *
 * Dynamic SQL (varying IN-list arity) must NOT go through this helper — each
 * arity is a distinct SQL string and would grow the cache without bound.
 */
const cache = new WeakMap<Database, Map<string, Statement<never, never>>>();

export function prepared<Row, Params extends SQLQueryBindings[]>(
  db: Database,
  sql: string,
): Statement<Row, Params> {
  let perDb = cache.get(db);
  if (!perDb) {
    perDb = new Map();
    cache.set(db, perDb);
  }
  let statement = perDb.get(sql);
  if (!statement) {
    statement = db.query<never, never>(sql);
    perDb.set(sql, statement);
  }
  // The cache is keyed on SQL alone; row/param types are bound at the call site.
  return statement as Statement<Row, Params>;
}

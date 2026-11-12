/**
 * Adapter: Cloudflare Durable Object SqlStorage → better-sqlite3-like prepare API.
 *
 * DO `sql.exec()` returns a SqlStorageCursor with `rowsWritten`, not `{ changes }`.
 * Domain code (deliver / replace / …) checks `if (!result.changes)` — without this
 * mapping every write looks like zero rows on Cloudflare.
 */
export function createDoSqliteAdapter(sql) {
  return {
    exec: (statement) => {
      // Drain so statements with no result rows still finalize writes.
      Array.from(sql.exec(statement));
    },
    prepare: (statement) => ({
      all: (...bindings) => sql.exec(statement, ...bindings).toArray(),
      get: (...bindings) => sql.exec(statement, ...bindings).toArray()[0],
      run: (...bindings) => {
        const cursor = sql.exec(statement, ...bindings);
        // rowsWritten grows as the cursor is consumed — drain before reading.
        Array.from(cursor);
        return { changes: cursor.rowsWritten ?? 0 };
      },
    }),
  };
}

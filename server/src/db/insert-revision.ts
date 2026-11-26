import { eq, max } from "drizzle-orm";
import type { Db } from "./client.js";
import { revisions } from "./schema.js";

export type NewRevision = Omit<typeof revisions.$inferInsert, "id" | "version" | "createdAt">;
export type Revision = typeof revisions.$inferSelect;

// Reads max(version) and inserts max + 1 in one transaction. If another
// request inserted the same version first, the unique constraint throws;
// the caller turns that into a 409 (see uniqueViolation).
export async function insertRevision(db: Db, values: NewRevision): Promise<Revision> {
  return db.transaction(async (tx) => {
    const [{ current }] = await tx
      .select({ current: max(revisions.version) })
      .from(revisions)
      .where(eq(revisions.specId, values.specId));

    const [row] = await tx
      .insert(revisions)
      .values({ ...values, version: (current ?? 0) + 1 })
      .returning();
    return row;
  });
}

// Returns the constraint name if err is a Postgres unique violation.
// Drizzle wraps driver errors, so the pg error is on `cause`.
export function uniqueViolation(err: unknown): string | undefined {
  const pgError = err instanceof Error && err.cause ? err.cause : err;
  if (typeof pgError === "object" && pgError !== null && "code" in pgError && pgError.code === "23505") {
    return "constraint" in pgError ? String(pgError.constraint) : undefined;
  }
  return undefined;
}

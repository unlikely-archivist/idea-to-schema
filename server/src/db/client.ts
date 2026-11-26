import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type Client } from "pg";
import * as schema from "./schema.js";

// Node (dev and tests) shares one pool. The Worker makes one Client per request (see worker.ts).
export type Db = NodePgDatabase<typeof schema> & { $client: Pool | Client };

export function createDb(url: string) {
  return drizzle(new Pool({ connectionString: url }), { schema });
}

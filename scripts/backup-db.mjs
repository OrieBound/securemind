/**
 * Temporary M2 helper: dump every table to a timestamped JSON file so the
 * rename migration can be rolled back by hand if it goes wrong.
 *
 * Writes to backups/, which is gitignored.
 */
import pg from "pg";
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";

config({ path: ".env.local" });

const pool = new pg.Pool({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});

const TABLES = [
  "Workspace",
  "Session", "Message", "SessionSummary",
  "WorkspaceFact",
  "Document", "MemoryFragment",
];

const dump = {};
for (const t of TABLES) {
  try {
    // Exclude the vector column — pg cannot serialize it and it is derived data.
    const { rows } = await pool.query(`SELECT * FROM "${t}"`);
    dump[t] = rows;
    console.log(`${t.padEnd(16)} ${rows.length} rows`);
  } catch {
    // Table does not exist at this point in the migration — expected.
  }
}

mkdirSync("backups", { recursive: true });
const file = `backups/backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(dump, null, 2));
console.log(`\nwrote ${file}`);

await pool.end();

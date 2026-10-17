/**
 * Re-embed stored Knowledge with the nomic document prefix (local Postgres install).
 *
 *   npm run knowledge:reindex                 # every user
 *   npm run knowledge:reindex -- --user <id>  # one user
 *
 * Needs the database and Ollama running (docker compose up). Safe to re-run.
 */

import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/lib/db");
  const { reindexKnowledgeEmbeddings } = await import("../src/lib/knowledge-reindex");

  const flag = process.argv.indexOf("--user");
  const only = flag >= 0 ? process.argv[flag + 1] : undefined;

  const users = only
    ? [only]
    : (
        await db.memoryFragment.findMany({
          where: { category: "document" },
          distinct: ["userId"],
          select: { userId: true },
        })
      ).map(row => row.userId);

  if (users.length === 0) {
    console.log("No Knowledge chunks found.");
    return;
  }

  for (const userId of users) {
    const result = await reindexKnowledgeEmbeddings({
      userId,
      onProgress: done => process.stdout.write(`\r${userId}: ${done} chunks`),
    });
    process.stdout.write("\n");
    if (result.skipped) {
      console.log(`${userId}: skipped. ${result.skipped}`);
    } else {
      console.log(`${userId}: re-indexed ${result.reindexed}, failed ${result.failed}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

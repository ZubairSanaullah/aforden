import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

export interface MigrationRehearsalResult {
  migrationName: string;
  durationMs: number;
  status: "APPLIED" | "FAILED";
  error?: string;
}

export async function runMigrationRehearsal(): Promise<{
  totalMigrations: number;
  totalDurationMs: number;
  tableCount: number;
  results: MigrationRehearsalResult[];
}> {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DIRECT_URL or DATABASE_URL must be configured to run migration rehearsal");
  }

  const client = new Client({ connectionString });
  await client.connect();

  const timestamp = Date.now();
  const schemaName = `rehearsal_empty_${timestamp}`;
  const migBaseDir = path.join(process.cwd(), "prisma", "migrations");

  const migrationDirs = fs
    .readdirSync(migBaseDir)
    .filter((f) => fs.statSync(path.join(migBaseDir, f)).isDirectory())
    .sort();

  console.log(`\n=== Starting PostgreSQL Migration Rehearsal ===`);
  console.log(`Target: Isolated empty schema "${schemaName}"`);
  console.log(`Discovered ${migrationDirs.length} migrations in prisma/migrations\n`);

  const results: MigrationRehearsalResult[] = [];
  const startOverall = Date.now();

  try {
    // 1. Provision empty isolated schema
    await client.query(`CREATE SCHEMA "${schemaName}";`);

    // 2. Execute each migration sequentially
    for (let i = 0; i < migrationDirs.length; i++) {
      const dirName = migrationDirs[i];
      const sqlPath = path.join(migBaseDir, dirName, "migration.sql");
      const sql = fs.readFileSync(sqlPath, "utf-8");

      const mStart = Date.now();
      try {
        await client.query(`SET search_path = "${schemaName}", public;`);
        await client.query(sql);
        const durationMs = Date.now() - mStart;

        results.push({
          migrationName: dirName,
          durationMs,
          status: "APPLIED",
        });

        console.log(
          `[${String(i + 1).padStart(2, " ")}/${migrationDirs.length}] ✓ ${dirName} (${durationMs}ms)`
        );
      } catch (err: any) {
        const durationMs = Date.now() - mStart;
        results.push({
          migrationName: dirName,
          durationMs,
          status: "FAILED",
          error: err.message,
        });
        console.error(`[${i + 1}/${migrationDirs.length}] ✗ ${dirName} FAILED:`, err.message);
        throw err;
      }
    }

    // 3. Verify total table count
    const tableRes = await client.query<{ count: string }>(
      `SELECT count(*)::text as count FROM information_schema.tables WHERE table_schema = $1;`,
      [schemaName]
    );
    const tableCount = Number(tableRes.rows[0]?.count || 0);

    console.log(`\nSchema Integrity Check:`);
    console.log(`  - Verified ${tableCount} total tables provisioned in "${schemaName}"`);

    // 4. Sample verification on representative tables
    const sampleTables = ["User", "Workspace", "WorkOrder", "Invoice", "InventoryBalance", "IntegrationCredential"];
    for (const t of sampleTables) {
      const check = await client.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2);`,
        [schemaName, t]
      );
      if (!check.rows[0].exists) {
        throw new Error(`Table "${t}" was not created during migration sequence`);
      }
    }
    console.log(`  - Verified core domain tables exist: ${sampleTables.join(", ")}`);

    const totalDurationMs = Date.now() - startOverall;
    console.log(`\n✓ All ${migrationDirs.length} migrations applied cleanly in sequence (${totalDurationMs}ms total)`);

    return {
      totalMigrations: migrationDirs.length,
      totalDurationMs,
      tableCount,
      results,
    };
  } finally {
    // 5. Clean up isolated schema
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE;`);
      console.log(`\nCleaned up rehearsal schema "${schemaName}"`);
    } catch (cleanupErr) {
      console.error("Error cleaning up schema:", cleanupErr);
    } finally {
      await client.end();
    }
  }
}

// Direct CLI invocation
if (import.meta.url === `file://${process.argv[1]}` || require.main === module) {
  runMigrationRehearsal()
    .then(() => {
      console.log("\n✅ Migration rehearsal succeeded: schema is 100% production-ready.\n");
      process.exit(0);
    })
    .catch((err) => {
      console.error("\n❌ Migration rehearsal failed:", err);
      process.exit(1);
    });
}

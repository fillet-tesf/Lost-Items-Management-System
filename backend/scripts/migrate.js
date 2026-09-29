require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../db");

const migrationsDirectory = path.join(__dirname, "../database/migrations");
const trackingTable = "schema_migrations";

function query(sql, parameters = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, parameters, (error, results) => {
      if (error) return reject(error);
      resolve(results);
    });
  });
}

function closeDatabase() {
  return new Promise((resolve) => db.end(() => resolve()));
}

function splitSql(source) {
  return source
    .split(/;\s*(?=\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function listMigrationFiles() {
  const sqlFiles = fs
    .readdirSync(migrationsDirectory)
    .filter((name) => name.toLowerCase().endsWith(".sql"));

  const migrations = sqlFiles.map((name) => {
    const match = name.match(/^(\d{4})_[a-z0-9_-]+\.sql$/i);
    if (!match) throw new Error(`Invalid migration filename: ${name}`);

    return {
      name,
      id: name.slice(0, -4),
      version: Number(match[1]),
    };
  });

  migrations.sort(
    (left, right) =>
      left.version - right.version ||
      (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
  );

  const versions = new Set();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(
        `Duplicate migration version ${String(migration.version).padStart(4, "0")}: ${migration.name}`,
      );
    }
    versions.add(migration.version);
  }

  if (migrations.length === 0) {
    throw new Error("No valid migration files were found.");
  }

  return migrations;
}

function validateAppliedMigrations(migrations, appliedIds) {
  const knownIds = new Set(migrations.map((migration) => migration.id));
  for (const migrationId of appliedIds) {
    if (!knownIds.has(migrationId)) {
      throw new Error(`Database contains an unknown migration: ${migrationId}`);
    }
  }

  let foundPendingMigration = false;
  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      if (foundPendingMigration) {
        throw new Error(
          `Invalid migration history: ${migration.id} is applied after an unapplied migration.`,
        );
      }
    } else {
      foundPendingMigration = true;
    }
  }
}

async function listTables() {
  const rows = await query("SHOW TABLES");
  return rows.map((row) => String(Object.values(row)[0]));
}

async function ensureTrackingTable() {
  let tables = await listTables();
  const hasTrackingTable = tables.includes(trackingTable);

  if (!hasTrackingTable && tables.length > 0) {
    throw new Error(
      "Refusing to initialize a non-empty database without migration history. Use a new empty database.",
    );
  }

  if (!hasTrackingTable) {
    await query(
      `CREATE TABLE ${trackingTable} (
        migration_id VARCHAR(190) NOT NULL PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    );
  } else {
    // This also verifies that an existing tracking table has the expected column.
    await query(`SELECT migration_id FROM ${trackingTable} LIMIT 0`);
  }

  tables = await listTables();
  return tables.filter((name) => name !== trackingTable);
}

async function main() {
  try {
    const migrations = listMigrationFiles();
    await db.ready;
    const nonTrackingTables = await ensureTrackingTable();

    const appliedRows = await query(`SELECT migration_id FROM ${trackingTable}`);
    const applied = new Set(appliedRows.map((row) => row.migration_id));
    if (applied.size !== appliedRows.length) {
      throw new Error("Invalid migration history: duplicate migration IDs were recorded.");
    }
    validateAppliedMigrations(migrations, applied);

    const pending = migrations.filter((migration) => !applied.has(migration.id));
    if (pending.length > 0 && applied.size === 0 && nonTrackingTables.length > 0) {
      throw new Error(
        "Refusing to apply the initial baseline because the database is not empty. Use a new empty database.",
      );
    }

    for (const migration of pending) {
      const sql = fs.readFileSync(
        path.join(migrationsDirectory, migration.name),
        "utf8",
      );
      const statements = splitSql(sql);
      if (statements.length === 0) {
        throw new Error(`Migration is empty: ${migration.name}`);
      }

      console.log(`Applying migration ${migration.id}`);
      // MySQL DDL implicitly commits. The runner records a version only after every
      // statement succeeds and never attempts an automatic destructive rollback.
      for (const statement of statements) await query(statement);
      await query(`INSERT INTO ${trackingTable} (migration_id) VALUES (?)`, [
        migration.id,
      ]);
    }

    console.log(`Database migrations complete (${pending.length} applied).`);
  } catch (error) {
    console.error(
      "Database migration failed; no later migration was attempted.",
      error.code || error.message,
    );
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

main();

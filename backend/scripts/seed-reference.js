require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../db");

const baselineId = "0001_initial_schema";
const seedPath = path.join(__dirname, "../database/seeds/reference-data.sql");
const expectedStatuses = [
  [1, "pending"],
  [2, "verified"],
  [3, "rejected"],
  [4, "claimed"],
  [5, "returned"],
  [6, "deleted"],
];
const expectedLocations = [
  "Addis Ababa",
  "Dire Dawa",
  "Adama (Nazret)",
  "Hawassa",
  "Bahir Dar",
  "Mekelle",
  "Jimma",
  "Dessie",
  "Gondar",
  "Harar",
  "Afar Region",
  "Amhara Region",
  "Oromia Region",
  "Somali Region",
  "Tigray Region",
  "Sidama Region",
  "Central Ethiopia Region",
  "South Ethiopia Region",
  "South West Ethiopia Region",
  "Benishangul-Gumuz Region",
  "Gambela Region",
  "Harari Region",
];

const expectedCategories = [
  "Phone",
  "ID Card",
  "Wallet",
  "Document",
  "Other",
];

function query(connection, sql, parameters = []) {
  return new Promise((resolve, reject) => {
    connection.query(sql, parameters, (error, results) => {
      if (error) return reject(error);
      resolve(results);
    });
  });
}

function transaction(connection, method) {
  return new Promise((resolve, reject) => {
    connection[method]((error) => (error ? reject(error) : resolve()));
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

async function main() {
  let connection;
  let transactionStarted = false;
  try {
    await db.ready;
    connection = await new Promise((resolve, reject) => {
      db.getConnection((error, checkedOutConnection) => {
        if (error) return reject(error);
        resolve(checkedOutConnection);
      });
    });
    const applied = await query(
      connection,
      "SELECT migration_id FROM schema_migrations WHERE migration_id = ? LIMIT 1",
      [baselineId],
    );
    if (applied.length === 0) {
      throw new Error("Apply the initial schema migration before seeding references.");
    }

    await transaction(connection, "beginTransaction");
    transactionStarted = true;
    const statements = splitSql(fs.readFileSync(seedPath, "utf8"));
    if (statements.length === 0) throw new Error("Reference seed file is empty.");
    for (const statement of statements) await query(connection, statement);

    const statusRows = await query(
      connection,
      "SELECT id, status_name FROM item_statuses WHERE id BETWEEN 1 AND 6 OR status_name IN (?, ?, ?, ?, ?, ?)",
      expectedStatuses.map(([, name]) => name),
    );
    for (const [id, statusName] of expectedStatuses) {
      if (!statusRows.some((row) => Number(row.id) === id && row.status_name === statusName)) {
        throw new Error(
          `Reference status conflict for ${statusName}; review the item_statuses table before retrying.`,
        );
      }
    }

    const locationRows = await query(
      connection,
      `SELECT name FROM locations WHERE name IN (${expectedLocations.map(() => "?").join(", ")})`,
      expectedLocations,
    );
    const foundLocations = new Set(locationRows.map((row) => row.name));
    const missingLocations = expectedLocations.filter((name) => !foundLocations.has(name));
    if (missingLocations.length > 0) {
      throw new Error(
        `Some reference locations conflict with existing values; review locations before retrying (${missingLocations.length} missing).`,
      );
    }

    const categoryRows = await query(
      connection,
      `SELECT name FROM categories WHERE name IN (${expectedCategories.map(() => "?").join(", ")})`,
      expectedCategories,
    );
    const foundCategories = new Set(categoryRows.map((row) => row.name));
    const missingCategories = expectedCategories.filter((name) => !foundCategories.has(name));
    if (missingCategories.length > 0) {
      throw new Error(
        `Some approved categories are missing; review categories before retrying (${missingCategories.length} missing).`,
      );
    }

    await transaction(connection, "commit");
    transactionStarted = false;
    console.log("Reference seed complete (statuses, locations, and approved categories verified).");
  } catch (error) {
    if (transactionStarted) {
      await transaction(connection, "rollback").catch(() => {});
    }
    console.error(
      "Reference seeding failed; conflicting rows were not overwritten.",
      error.code || error.message,
    );
    process.exitCode = 1;
  } finally {
    if (connection) connection.release();
    await closeDatabase();
  }
}

main();

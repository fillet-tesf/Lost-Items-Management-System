const mysql = require("mysql2");

const requiredEnvironmentVariables = [
  "DB_HOST",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
];

for (const name of requiredEnvironmentVariables) {
  if (!process.env[name] || process.env[name].trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const portValue = process.env.DB_PORT || "3306";
const port = Number(portValue);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Invalid DB_PORT: expected an integer from 1 to 65535");
}

const sslValue = (process.env.DB_SSL || "false").trim().toLowerCase();
if (sslValue !== "true" && sslValue !== "false") {
  throw new Error("Invalid DB_SSL: expected true or false");
}

const connectionOptions = {
  host: process.env.DB_HOST,
  port,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

if (sslValue === "true") {
  connectionOptions.ssl = { rejectUnauthorized: true };
}

// Keep a single pooled connection to preserve the existing shared-session
// behavior while allowing mysql2 to replace a connection after it is closed.
const db = mysql.createPool({
  ...connectionOptions,
  connectionLimit: 1,
  waitForConnections: true,
});

db.ready = new Promise((resolve, reject) => {
  db.getConnection((err, connection) => {
    if (err) {
      console.error(`Database connection failed (${err.code || "unknown error"})`);
      reject(err);
      return;
    }

    connection.release();
    console.log("Connected to MySQL database");
    resolve();
  });
});

// Preserve the shutdown hook used by server.js on startup failure.
db.destroy = () => db.end();

module.exports = db;

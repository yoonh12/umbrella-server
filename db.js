const mysql = require("mysql2");

function createPool() {
  return mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWD,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    connectionLimit: 10, // You can adjust the connection pool size as needed.
  });
}

function queryPromise(pool, query, params) {
  return new Promise((resolve, reject) => {
    pool.query(query, params, (error, results) => {
      if (error) {
        reject(error);
      } else {
        resolve(results);
      }
    });
  });
}

function handleDatabaseError(res, error) {
  console.error("Database error:", error);
  res.status(500).json("Database error occurred.");
}

module.exports = { createPool, queryPromise, handleDatabaseError };

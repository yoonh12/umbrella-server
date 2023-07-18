// db.js
const mysql = require("mysql");

function createConnection() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWD,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
  });
}

function queryPromise(connection, query, params) {
  return new Promise((resolve, reject) => {
    connection.query(query, params, (error, results) => {
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
  res.status(400).json("Database error occurred.");
}

module.exports = { createConnection, queryPromise, handleDatabaseError };

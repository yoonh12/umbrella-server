const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql");

require("dotenv").config();

const PORT = process.env.APP_PORT,
  tableName = process.env.DB_TABLE;

const app = express();
app.use(bodyParser.json());

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWD,
  PORT: process.env.DB_PORT,
  database: process.env.DB_NAME
});

app.use(cors());

app.post("/send", (req, res) => {
  const { stats, stdId, umbId } = req.body;
  let data = { std_id: stdId, umb_id: umbId };

  console.log(data);

  if (stats === "rental") {
    connection.query(`INSERT INTO ${tableName} set ? `, data, (err) => {
      if (err) {
        // if Error
        res.status(400).json("Rental Err.");
        console.log("Error: %s ", err);
      } else res.status(200).json("Successfully added data into DB."); // not Error
    });
  } else if (stats === "return") {
    connection.query(
      `DELETE FROM ${tableName} WHERE umb_id=${umbId}`,
      null,
      (err) => {
        if (err) {
          res.status(400).json("Return Err.");
        } else res.status(200).json("Successfully deleted data from DB.");
      }
    );
  }
});

app.listen(PORT, () => {
  console.log(`This app is running on ${PORT}.`);
});

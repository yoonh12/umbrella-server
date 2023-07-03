const express = require("express");
const https = require("https");
const File = require("fs");
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql");

require("dotenv").config();

const PORT = process.env.APP_PORT,
  tableName = process.env.DB_TABLE;

const app = express();
app.use(bodyParser.json());

const server = https.createServer(
  {
    ca: File.readFileSync(
      "/etc/letsencrypt/live/api.neoflux.club/fullchain.pem"
    ),
    key: File.readFileSync(
      "/etc/letsencrypt/live/api.neoflux.club/privkey.pem"
    ),
    cert: File.readFileSync("/etc/letsencrypt/live/api.neoflux.club/cert.pem"),
  },
  app
);

app.use(cors()); // CORS

app.use((err, req, res, next) => {
  console.error(err); // Error logging

  // Send to client
  res.status(500).send("Internal Server Error");
});

app.post("/", (req, res) => {
  try {
    const connection = mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWD,
      PORT: process.env.DB_PORT,
      database: process.env.DB_NAME,
    });

    const date = new Date();
    const { isRenting, stdId, umbId, rentalDate, returnDate, willChk } =
      req.body;
    let data = {
      std_id: stdId,
      umb_id: umbId,
      rental_date: rentalDate,
      return_date: returnDate,
    };

    // logging
    if (data.std_id !== undefined) {
      File.appendFile("server.log", `Rental: ${JSON.stringify(data)}\n`, function () {
        console.log("Rental:", data);
      });
    } else if (data.std_id === undefined) {
      File.appendFile("server.log", `Return: ${JSON.stringify(data)}\n`, function () {
        console.log("Return:", data);
      });
    }

    if (willChk === true) {
      let delayed = new Object();
      let checkStdId = new Object();
      connection.query(
        `SELECT * FROM ${tableName} WHERE return_delayed=1 AND std_id=?`,
        [stdId],
        (err, row) => {
          if (err) {
            res.status(400).json("Error while Check");
            console.log("Error: %s", err);
          }

          if (row.length === 0) {
            delayed.notDelayed = true;
          } else {
            delayed.notDelayed = false;
            res.send(delayed);
            connection.end();
          }

          if (delayed.notDelayed === true) {
            connection.query(
              `SELECT * FROM ${tableName} WHERE std_id=?`,
              [stdId],
              (err, row) => {
                if (err) {
                  res.status(400).json("Error while Check");
                  console.log("Error: %s", err);
                }

                if (row.length === 0) {
                  checkStdId.isAvailable = true;
                } else {
                  checkStdId.isAvailable = false;
                }

                res.send(checkStdId);
                connection.end();
              }
            );
          }
        }
      );
    } else {
      if (isRenting === true) {
        let checkUmbId = new Object();
        checkUmbId.isAvailable = true;
        connection.query(
          `SELECT * FROM ${tableName} WHERE umb_id=? AND return_delayed=0`,
          [umbId],
          (err, row) => {
            if (err) {
              res.status(400).json("Error while Check Umbrella Exist");
              console.log("Error: %s", err);

              connection.end();
            }

            if (row.length > 0) {
              checkUmbId.isAvailable = false;
              res.send(checkUmbId);

              connection.end();
            } else {
              connection.query(
                `INSERT INTO ${tableName} set ?`,
                data,
                (err) => {
                  if (err) {
                    // if Error
                    res.status(400).json("Error while Rental");
                    console.log("Error: %s", err);

                    connection.end();
                  } else
                    res.status(200).json("Successfully added data into DB.");
                  connection.end(); // not Error
                }
              );
            }
          }
        );
      } else if (isRenting === false) {
        let noUmbData = false;
        let deadline = new Object();
        connection.query(
          `SELECT * FROM ${tableName} WHERE umb_id=? AND return_delayed=0`,
          [umbId],
          (err, row) => {
            if (err) {
              res.status(400).json("Error while Check Rental Date");

              connection.end();
            }

            if (row.length > 0 && row[0].return_date) {
              if (date > row[0].return_date) {
                // deadline.outOfDate = date - row[0].return_date;

                diff = Math.abs(date.getTime() - row[0].return_date.getTime());
                deadline.outOfDate = Math.ceil(diff / (1000 * 60 * 60 * 24));
                console.log(deadline);

                connection.query(
                  `UPDATE ${tableName} SET return_delayed = 1 WHERE umb_id=? AND return_delayed=0`,
                  [umbId],
                  (err) => {
                    if (err) {
                      res.status(400).json("Error while update");
                      console.log("Error: %s", err);

                      connection.end();
                    } else res.send(deadline);

                    connection.end();
                  }
                );
              } else {
                connection.query(
                  `DELETE FROM ${tableName} WHERE umb_id=? AND return_delayed=0`,
                  [umbId],
                  (err) => {
                    if (err) {
                      res.status(400).json("Error while Return");
                      console.log("Error: %s", err);

                      connection.end();
                    } else
                      res
                        .status(200)
                        .json("Successfully deleted data from DB.");

                    connection.end();
                  }
                );
              }
            } else {
              noUmbData = true;
              res.send(noUmbData);

              connection.end();
            }
          }
        );
      } else {
        res.status(400).json("The values are not given correctly.");

        connection.end();
      }
    }
  } catch (e) {
    console.error(e);
  }
});

process.on("uncaughtException", (err) => {
  var data = `[${new Date().toLocaleString("ko-kr")}] Uncaught Exception: \n${
    err.stack
  }`;

  File.appendFile("server_error.log", `${data}\n`, function () {
    console.error(data);
  });
});

server.listen(PORT, () => {
  console.log(`This app is running on ${PORT}.`);
});

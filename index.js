const express = require("express");
const https = require("https");
const File = require("fs");
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql");
const moment = require("moment-timezone");

require("dotenv").config();

const PORT = process.env.APP_PORT,
  tableName = process.env.DB_TABLE;

const app = express();
app.use(bodyParser.json());

const server = https.createServer(
  {
    ca: File.readFileSync(
      "/etc/letsencrypt/live/api.andong.hs.kr/fullchain.pem"
    ),
    key: File.readFileSync(
      "/etc/letsencrypt/live/api.andong.hs.kr/privkey.pem"
    ),
    cert: File.readFileSync("/etc/letsencrypt/live/api.andong.hs.kr/cert.pem"),
  },
  app
);

app.use(cors()); // CORS

app.use((err, req, res, next) => {
  console.error(err); // Error logging

  // Send to client
  res.status(500).send("Internal Server Error");
});

app.post("/api", (req, res) => {
  try {
    const connection = mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWD,
      PORT: process.env.DB_PORT,
      database: process.env.DB_NAME,
    });

    connection.connect();

    const date = moment().tz("Asia/Seoul");
    const { isRenting, stdId, umbId, rentalDate, returnDate, willChk } =
      req.body;
    let data = {
      std_id: stdId,
      umb_id: umbId,
      rental_date: rentalDate,
      return_date: returnDate,
    };

    // logging
    function logToFileAndConsole(logType, logData, logMessage) {
      File.appendFile("server.log", `${logType}: ${JSON.stringify(logData)}\n`, function () {
        console.log(`${logType}:`, logData);
      });
    }
    
    logToFileAndConsole("Checking", data, "Checking:");
    logToFileAndConsole("Rental", data, "Rental:");
    logToFileAndConsole("Return", data, "Return:");
    

    if (willChk === true) {
      let delayed = new Object();
      let checkStdId = new Object();
      connection.query(
        `SELECT * FROM ${tableName} WHERE return_status=1 AND std_id=?`,
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
          `SELECT * FROM ${tableName} WHERE umb_id=? AND return_status=0`,
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
          `SELECT * FROM ${tableName} WHERE umb_id=? AND return_status=0`,
          [umbId],
          (err, row) => {
            if (err) {
              res.status(400).json("Error while Check Rental Date");

              connection.end();
            }

            
            if (row.length > 0 && row[0].return_date) {
              if (date > moment(row[0].return_date).tz("Asia/Seoul")) {
                diff = Math.abs(moment().valueOf() - moment(row[0].return_date).tz("Asia/Seoul"));
                deadline.outOfDate =
                  Math.ceil(diff / (24 * 60 * 60 * 1000)) - 1;
                console.log(deadline);

                connection.query(
                  `UPDATE ${tableName} SET return_status=1 WHERE umb_id=? AND return_status=0`,
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
                  `DELETE FROM ${tableName} WHERE umb_id=? AND return_status=0`,
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

function updateReturnDelayed() {
  try {
    const conn = mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWD,
      PORT: process.env.DB_PORT,
      database: process.env.DB_NAME,
    });
    conn.connect();
    conn.query(
      `SELECT * FROM ${tableName} WHERE return_delayed=0`,
      null,
      (err, row) => {
        if (err) {
          console.log(err);
          conn.end();
        }
        if (row.length > 0) {
          for (let usr = 0; usr < row.length; usr++) {
            if (
              moment().format("YYYY-MM-DD") >
              moment(row[usr].return_date).tz("Asia/Seoul").format("YYYY-MM-DD")
            ) {
              conn.query(
                `UPDATE ${tableName} SET return_delayed = 1 WHERE std_id=?`,
                [row[usr].std_id],
                (err) => {
                  if (err) {
                    console.log("Error: %s", err);
                    conn.end();
                  } else conn.end();
                }
              );
            }
          }
          conn.end();
        } else {
          conn.end();
        }
      }
    );
  } catch (e) {
    console.log(e);
  }
}

server.listen(PORT, () => {
  console.log(`This app is running on ${PORT}.`);
});

setInterval(() => {
  updateReturnDelayed();
}, 1 * 60 * 60 * 1000);
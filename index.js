// index.js
const express = require("express");
const https = require("https");
const File = require("fs");
const bodyParser = require("body-parser");
const cors = require("cors");
const moment = require("moment-timezone");
const db = require("./db");

require("dotenv").config();

const PORT = process.env.APP_PORT;
const tableName = process.env.DB_TABLE;

const app = express();
app.use(bodyParser.json());

let server;

server = https.createServer(
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

const SERVER = server ?? app;

app.use(cors()); // CORS

app.use((err, req, res, next) => {
  console.error(err); // Error logging
  res.status(500).send("Internal Server Error");
});

app.post("/api", async (req, res) => {
  try {
    const connection = db.createConnection();
    connection.connect();

    const date = moment().tz("Asia/Seoul");
    const { isRenting, stdId, umbId, rentalDate, returnDate, willChk } =
      req.body;
    const data = {
      std_id: stdId,
      umb_id: umbId,
      rental_date: rentalDate,
      return_date: returnDate,
    };

    function logToFileAndConsole(logType, logData) {
      const logEntry = `[${moment().tz("Asia/Seoul").format("yyyy-MM-DD HH:mm:ss")}] ${logType}: ${JSON.stringify(logData)}\n`;
      File.appendFile("server.log", logEntry, () => {
        console.log(`${logType}:`, logData);
      });
    }

    if (data.umb_id === undefined) {
      logToFileAndConsole("Checking", data);
    }

    if (data.umb_id && data.std_id !== undefined) {
      logToFileAndConsole("Rental", data);
    }

    if (data.std_id === undefined) {
      logToFileAndConsole("Return", data);
    }

    if (willChk === true) {
      const delayed = { notDelayed: true };
      const checkStdId = { isAvailable: true };

      try {
        const [delayedResult, checkStdIdResult] = await Promise.all([
          queryPromise(
            connection,
            `SELECT * FROM ${tableName} WHERE return_status=1 AND std_id=?`,
            [stdId]
          ),
          queryPromise(
            connection,
            `SELECT * FROM ${tableName} WHERE std_id=?`,
            [stdId]
          ),
        ]);

        if (delayedResult.length === 0) {
          delayed.notDelayed = false;
          res.send(delayed);
        }

        if (delayed.notDelayed === true) {
          if (checkStdIdResult.length > 0) {
            checkStdId.isAvailable = false;
          }

          res.send(checkStdId);
        }
      } catch (error) {
        handleDatabaseError(res, error);
      }
    } else {
      if (isRenting === true) {
        const checkUmbId = { isAvailable: true };

        try {
          const row = await queryPromise(
            connection,
            `SELECT * FROM ${tableName} WHERE umb_id=? AND return_status=0`,
            [umbId]
          );

          if (row.length > 0) {
            checkUmbId.isAvailable = false;
            res.send(checkUmbId);
          } else {
            await queryPromise(
              connection,
              `INSERT INTO ${tableName} SET ?`,
              data
            );
            res.status(200).json("Successfully added data into DB.");
          }
        } catch (error) {
          handleDatabaseError(res, error);
        }
      } else if (isRenting === false) {
        let noUmbData = false;
        let deadline = new Object();

        try {
          const row = await queryPromise(
            connection,
            `SELECT * FROM ${tableName} WHERE umb_id=? AND return_status=0`,
            [umbId]
          );

          if (row.length > 0 && row[0].return_date) {
            if (date > moment(row[0].return_date).tz("Asia/Seoul")) {
              const diff = Math.abs(
                moment().valueOf() - moment(row[0].return_date).tz("Asia/Seoul")
              );
              deadline.outOfDate = Math.ceil(diff / (24 * 60 * 60 * 1000)) - 1;
              console.log(deadline);

              await queryPromise(
                connection,
                `UPDATE ${tableName} SET return_status=1 WHERE umb_id=? AND return_status=0`,
                [umbId]
              );

              res.send(deadline);
            } else {
              await queryPromise(
                connection,
                `DELETE FROM ${tableName} WHERE umb_id=? AND return_status=0`,
                [umbId]
              );
              res.status(200).json("Successfully deleted data from DB.");
            }
          } else {
            noUmbData = true;
            res.send(noUmbData);
          }
        } catch (error) {
          handleDatabaseError(res, error);
        }
      } else {
        res.status(400).json("The values are not given correctly.");
      }
    }

    connection.end();
  } catch (e) {
    console.error(e);
  }
});

process.on("uncaughtException", (err) => {
  const data = `[${new Date().toLocaleString("ko-kr")}] Uncaught Exception: \n${
    err.stack
  }`;
  File.appendFile("server_error.log", `${data}\n`, () => {
    console.error(data);
  });
});

function updateReturnDelayed() {
  try {
    const conn = db.createConnection();
    conn.connect();

    conn.query(
      `SELECT * FROM ${tableName} WHERE return_delayed=0`,
      null,
      async (err, row) => {
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
              try {
                await queryPromise(
                  conn,
                  `UPDATE ${tableName} SET return_delayed = 1 WHERE std_id=?`,
                  [row[usr].std_id]
                );
              } catch (error) {
                console.log("Error: %s", error);
              }
            }
          }
        }

        conn.end();
      }
    );
  } catch (e) {
    console.log(e);
  }
}

SERVER.listen(PORT, () => {
  console.log(`This app is running on ${PORT}.`);
});

setInterval(updateReturnDelayed, 1 * 60 * 60 * 1000);

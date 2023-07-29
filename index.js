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
      "/etc/letsencrypt/live/umbrella.andong.hs.kr/fullchain.pem"
    ),
    key: File.readFileSync(
      "/etc/letsencrypt/live/umbrella.andong.hs.kr/privkey.pem"
    ),
    cert: File.readFileSync(
      "/etc/letsencrypt/live/umbrella.andong.hs.kr/cert.pem"
    ),
  },
  app
);

const SERVER = server ?? app;

let corsOptions;
corsOptions = {
  origin: "https://umbrella.andong.hs.kr",
  credentials: true,
};
app.use(cors(corsOptions ?? null)); // CORS

app.use((err, req, res, next) => {
  console.error(err); // Error logging
  res.status(500).send("Internal Server Error");
});

app.post("/api", async (req, res) => {
  try {
    const pool = db.createPool();

    const date = moment().tz("Asia/Seoul");
    const { isRenting, stdId, umbId, rentalDate, returnDate, willChk } =
      req.body;
    const data = {
      std_id: stdId,
      umb_id: umbId,
      rental_date: rentalDate,
      return_date: returnDate,
    };

    /* Logging */
    function logToFileAndConsole(logType, logData) {
      const logEntry = `[${moment()
        .tz("Asia/Seoul")
        .format("yyyy-MM-DD HH:mm:ss")}] ${logType}: ${JSON.stringify(
        logData
      )}\n`;
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
    /* Logging end. */

    if (willChk === true) {
      const delayed = { notDelayed: true };
      const checkStdId = { isAvailable: true };

      try {
        const [
          delayedResult,
          checkStdIdResult
        ] = await Promise.all([
          db.queryPromise(
            pool,
            `SELECT * FROM ${tableName} WHERE return_status=1 AND std_id=?`,
            [stdId]
          ),
          db.queryPromise(
            pool,
            `SELECT * FROM ${tableName} WHERE std_id=?`,
            [stdId]
          ),
        ]);

        // console.log(delayedResult, checkStdIdResult);

        if (delayedResult.length > 0) {
          // return_status=1, 연체된 이후 반납한 경우 대여 방지
          delayed.notDelayed = false; // 지연됨
          res.send(delayed);
        } else {
          if (checkStdIdResult.length > 0) {
            // 그렇지 않고 DB에 이미 등록된 사용자가 있으면
            checkStdId.isAvailable = false; // 사용자가 이미 등록되어, 대여 불가
          }
          res.send(checkStdId);
        }
      } catch (error) {
        db.handleDatabaseError(res, error);
      }
    } else {
      if (isRenting === true) {
        const checkUmbId = { isAvailable: true };

        try {
          const row = await db.queryPromise(
            pool,
            `SELECT * FROM ${tableName} WHERE umb_id=? AND return_status=0`,
            [umbId]
          );

          if (row.length > 0) {
            checkUmbId.isAvailable = false;
            res.send(checkUmbId);
          } else {
            await db.queryPromise(
              pool,
              `INSERT INTO ${tableName} SET ?`,
              data
            );
            // res.status(200).json("Successfully added data into DB.");
            res.send("Successfully added data into DB.");
          }
        } catch (error) {
          db.handleDatabaseError(res, error);
        }
      } else if (isRenting === false) {
        let noUmbData = false;
        let deadline = new Object();

        try {
          const row = await db.queryPromise(
            pool,
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

              await db.queryPromise(
                pool,
                `UPDATE ${tableName} SET return_status=1 WHERE umb_id=? AND return_status=0`,
                [umbId]
              );

              res.send(deadline);
            } else {
              await db.queryPromise(
                pool,
                `DELETE FROM ${tableName} WHERE umb_id=? AND return_status=0`,
                [umbId]
              );
              // res.status(200).json("Successfully deleted data from DB.");
              res.send("Successfully deleted data from DB.");
            }
          } else {
            noUmbData = true;
            res.send(noUmbData);
          }
        } catch (error) {
          db.handleDatabaseError(res, error);
        }
      } else {
        res.status(400).json("The values are not given correctly.");
      }
    }

    pool.end();
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
    const pool = db.createPool();

    pool.query(
      `SELECT * FROM ${tableName} WHERE return_delayed=0`,
      null,
      async (err, row) => {
        if (err) {
          console.log(err);
          pool.end();
        }

        if (row.length > 0) {
          for (let usr = 0; usr < row.length; usr++) {
            if (
              moment().format("YYYY-MM-DD") >
              moment(row[usr].return_date).tz("Asia/Seoul").format("YYYY-MM-DD")
            ) {
              try {
                await db.queryPromise(
                  pool,
                  `UPDATE ${tableName} SET return_delayed = 1 WHERE std_id=?`,
                  [row[usr].std_id]
                );
              } catch (error) {
                console.log("Error: %s", error);
              }
            }
          }
        }

        pool.end();
      }
    );
  } catch (e) {
    console.log(e);
  }
}

SERVER.listen(PORT, () => {
  console.log(`This app is running on ${PORT}.`);
});

setInterval(updateReturnDelayed, 1 * 60 * 1000);

function init() {
  updateReturnDelayed();
}

init();

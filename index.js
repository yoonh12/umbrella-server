const express = require("express");
const bodyParser = require("body-parser");
const https = require("https");
const cors = require("cors");
const File = require("fs");
const moment = require("moment-timezone");
const webpush = require("web-push");
const db = require("./db");
const cron = require("node-cron");

require("dotenv").config();

const PORT = process.env.APP_PORT;
const tableName = process.env.DB_TABLE;

const app = express();
app.use(bodyParser.json());

const publicKey = process.env.PUB_KEY,
  privateKey = process.env.PRIV_KEY;

const cronDelayUpdate = "* * * * *",
  cronAutoNotification = "0 9 * * *";

function getDateDifference(date1, date2) {
  // 대한민국 표준시(KST)로 시간대를 설정
  date1.tz("Asia/Seoul").startOf("day");
  date2.tz("Asia/Seoul").startOf("day");

  const diffInDays = date2.diff(date1, "days");
  return diffInDays;
}

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

    const {
      isRenting,
      stdId,
      umbId,
      rentalDate,
      returnDate,
      willChk,
      subscription,
    } = req.body;
    const data = {
      std_id: stdId,
      umb_id: umbId,
      rental_date: rentalDate,
      return_date: returnDate,
      subscription: subscription,
    };

    /* Logging */
    function logToFile(logType, logData) {
      const logEntry = `[${moment()
        .tz("Asia/Seoul")
        .format("yyyy-MM-DD HH:mm:ss")}] ${logType}: ${JSON.stringify(
        logData
      )}\n`;
      File.appendFile("server.log", logEntry, (err) => {
        if (err) {
          console.error(err);
        }
      });
    }

    if (data.umb_id === undefined) {
      logToFile("Checking", data);
    }

    if (data.umb_id && data.std_id !== undefined) {
      logToFile("Rental", data);
    }

    if (data.std_id === undefined) {
      logToFile("Return", data);
    }
    /* Logging end. */

    if (willChk === true) {
      const delayed = { notDelayed: true };
      const checkStdId = { isAvailable: true };

      try {
        const [delayedResult, checkStdIdResult] = await Promise.all([
          db.queryPromise(
            pool,
            `SELECT * FROM ${tableName} WHERE return_status=1 AND std_id=?`,
            [stdId]
          ),
          db.queryPromise(pool, `SELECT * FROM ${tableName} WHERE std_id=?`, [
            stdId,
          ]),
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
            await db.queryPromise(pool, `INSERT INTO ${tableName} SET ?`, data);
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
            deadline.outOfDate = getDateDifference(
              moment(row[0].return_date),
              moment()
            );
            if (deadline.outOfDate > 0) {
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
  } catch (error) {
    console.error(error);
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
          console.error(err);
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
                console.error("Error: %s", error);
              }
            }
          }
        }

        pool.end();
      }
    );
  } catch (error) {
    console.error(error);
  }
}

const sendNotificationFunc = async () => {
  try {
    const pool = db.createPool();

    const getTableData = async (columnName) => {
      return await db.queryPromise(
        pool,
        `SELECT ${columnName} FROM ${tableName}`,
        null
      );
    };

    const stdIds = await getTableData("std_id");
    const umbIds = await getTableData("umb_id"); // 구독자의 우산 번호 from DB
    const subscriptions = await getTableData("subscription"); // 구독 정보 from DB
    const returnDates = await getTableData("return_date"); // 반납 기한 정보 from DB
    const alertStatuses = await getTableData("sent_alert"); // 이전 알림 전송 여부 from DB

    if (
      umbIds.length > 0 &&
      subscriptions.length > 0 &&
      returnDates.length > 0
    ) {
      for (let i = 0; i < subscriptions.length; i++) {
        const returnDate = moment(returnDates[i].return_date); // 반납 기한
        const daysDiff = getDateDifference(moment(), returnDate); // 반납 기한과 오늘의 차
        const daysLeft = daysDiff + 1; // 남은 일 수 카운트를 위해 +1

        const payload = JSON.stringify({
          title: "우산 대여 서비스",
          body: `${JSON.stringify(
            umbIds[i].umb_id
          )}번 우산의 반납 기한이 3일 남았습니다.`,
        });

        const subscription = JSON.parse(subscriptions[i].subscription); // 구독 정보
        const isAlertSent = alertStatuses[i].sent_alert === 1;

        if (subscription && daysLeft === 3 && !isAlertSent) {
          // 구독중 & 반납 기한 3일 남음 & 알림 보낸 적 없음
          webpush.sendNotification(subscription, payload, {
            vapidDetails: {
              subject: "mailto:neoflux@sc.gyo6.net",
              publicKey,
              privateKey,
            },
          });
          await db.queryPromise(
            pool,
            `UPDATE ${tableName} SET sent_alert=1 WHERE std_id=?`,
            [stdIds[i].std_id]
          );
        }
      }
    }

    pool.end();
  } catch (error) {
    console.error("Send web push to client failed:", error);
  }
};

cron.schedule(cronDelayUpdate, () => {
  try {
    updateReturnDelayed();
  } catch (error) {
    console.error("Error while automatically updating DB:", error);
  }
});

cron.schedule(cronAutoNotification, async () => {
  try {
    await sendNotificationFunc();
  } catch (error) {
    console.error("Error while sending push notifications:", error);
  }
});

SERVER.listen(PORT, () => {
  console.log(`This app is running on ${PORT}.`);
});

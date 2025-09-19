const express = require("express");
const cors = require("cors");
const tagRouter = require("./router/tagRouter");
const editorRouter = require("./router/editorRouter");
const userRouter = require("./router/userRouter");
const sitemapRouter = require("./router/sitemapRouter");
const categoryRouter = require("./router/categoryRouter");
const logRouter = require("./router/logRouter");
const bannerRouter = require("./router/bannerRouter");
const editorLinkMangerRouter = require("./router/editorLinkMangerRouter");
require("dotenv").config();
require("./mongoose");
const session = require("express-session");
const fs = require("fs");
const https = require("https");
// const io = require('socket.io')

const app = express();
// const PORT = 4200
const PORT = process.env.PORT || 3000;
// const CorsOrgin
const corsOrgin = process.env.CORS_STR || "http://localhost:4200";
// const ssl
//const ssl = https.createServer(
//  {
//    key: fs.readFileSync("/etc/letsencrypt/live/bd.kashinobi.com/privkey.pem", {
//      encoding: "utf8",
//    }),
//    cert: fs.readFileSync(
//      "/etc/letsencrypt/live/bd.kashinobi.com/fullchain.pem",
//      { encoding: "utf8" }
//    ),
//  },
//  app
//);

const corsOptions = {
  origin: [
    "http://uat-dashboard.pickme.tw",
    "http://uat-front.pickme.tw",
    "http://uat-trend.pickme.tw",
    "http://uat-apidb.pickme.tw",
  ],
  optionsSuccessStatus: 200, //
  credentials: true,
  // methods: ["GET", "POST", "PATCH", "DELETE"],
  //some legacy browsers (IE11, various SmartTVs) choke on 204
};

app.use(express.json());
app.use(cors(corsOptions));

//set session attribute
app.use(
  session({
    secret: process.env.SESSIONSECRETKEY,
    // secret: crypto.randomUUID(),
    name: "sid", // optional
    cookie: {
      secure: false, //if set true only excute on https
      // path: userRouter,
      // maxAge: new Date(253402300000000), // Approximately Friday, 31 Dec 9999 23:59:59 GMT
      httpOnly: true,
      domain: ".pickme.tw",
      expires: 43200000,
    },
    maxAge: 28800000, // Approximately Friday, 31 Dec 9999 23:59:59 GMT
    saveUninitialized: false,
    resave: false, //avoid server race condition
    // store: MongoStore.create({ mongoUrl: process.env.CON_STR }),
  })
);

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Credentials", true);
  res.header(
    "Access-Control-Allow-Origin",
    "http://uat-dashboard.pickme.tw",
    "http://uat-front.pickme.tw",
    "http://uat-trend.pickme.tw",
    "http://uat-apidb.pickme.tw"
  );
  res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,PATCH");
  res.header(
    "Access-Control-Allow-Headers",
    "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept"
  );
  next();
});

app.use(bannerRouter);
app.use(sitemapRouter);
app.use(categoryRouter);
app.use(userRouter);
app.use(editorRouter);
app.use(tagRouter);
app.use(logRouter);
app.use(editorLinkMangerRouter);

// server.listen(4200)
app.listen(PORT, () => {
  console.log(`server started at port ${PORT}`);
});

// io.listen(server);

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
// const corsOrgin = process.env.CORS_STR || "http://localhost:4200";
// const ssl

const corsOptions = {
  origin: [
    "https://www.pickme.tw",
    "https://trend.pickme.tw",
    "https://bp.pickme.tw",
    "https://bd.pickme.tw",
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
      secure: true, //if set true only excute on https
      // path: userRouter,
      // maxAge: new Date(253402300000000), // Approximately Friday, 31 Dec 9999 23:59:59 GMT
      httpOnly: true,
      domain: ".pickme.tw",
      maxAge: 1000 * 60 * 60 * 8,
    },
    saveUninitialized: false,
    resave: false, //avoid server race condition
    // store: MongoStore.create({ mongoUrl: process.env.CON_STR }),
  })
);

app.use(bannerRouter);
app.use(sitemapRouter);
app.use(categoryRouter);
app.use(userRouter);
app.use(editorRouter);
app.use(tagRouter);
app.use(logRouter);
app.use(editorLinkMangerRouter);

app.listen(PORT, () => {
  console.log(`server started at port ${PORT}`);
});

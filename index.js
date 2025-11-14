const express = require("express");
const cors = require("cors");
const session = require("express-session");
const MongoStore = require("connect-mongo");

require("dotenv").config();
require("./mongoose");

const tagRouter = require("./router/tagRouter");
const editorRouter = require("./router/editorRouter");
const userRouter = require("./router/userRouter");
const sitemapRouter = require("./router/sitemapRouter");
const categoryRouter = require("./router/categoryRouter");
const logRouter = require("./router/logRouter");
const bannerRouter = require("./router/bannerRouter");
const editorLinkMangerRouter = require("./router/editorLinkMangerRouter");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ 修正 1：動態允許多網域 CORS
const allowedOrigins = [
  "https://www.pickme.tw",
  "https://trend.pickme.tw",
  "https://bp.pickme.tw",
  "https://bd.pickme.tw",
];

app.set("trust proxy", 1);

const corsOptions = {
  origin(origin, callback) {
    // 若沒有 Origin（例如 curl），直接允許
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());

// 讓 uploads 成為可公開讀取的靜態路徑
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const store = MongoStore.create({
  mongoUrl: process.env.CON_STR,
  mongoOptions: { serverSelectionTimeoutMS: 5000 },
});
store.on('connected', () => console.log("✅ MongoStore connected"));
store.on('error', (e) => console.error("❌ MongoStore error", e));

// ✅ 修正 2：Session 應放在 CORS 後、Router 前
app.use(
  session({
    secret: process.env.SESSIONSECRETKEY,
    name: "sid",
    store,
    cookie: {
      httpOnly: true,
      secure: true,         // 必須在 HTTPS 環境下
      sameSite: "none",     // ⭐ 允許跨子網域
      domain: ".pickme.tw", // ⭐ 共用 cookie 給 bp/bd
      maxAge: 1000 * 60 * 60 * 8, // 8 小時
    },
    saveUninitialized: false,
    resave: false,
  })
);

// ✅ 修正 3：統一 router 載入順序（session 在前）
app.use(bannerRouter);
app.use(sitemapRouter);
app.use(categoryRouter);
app.use(userRouter);
app.use(editorRouter);
app.use(tagRouter);
app.use(logRouter);
app.use(editorLinkMangerRouter);

// ✅ 修正 4：統一 listen 並打印 HTTPS 狀態
app.listen(PORT, () => {
  console.log(`✅ Server started at port ${PORT} (HTTPS ready, CORS enabled)`);
});

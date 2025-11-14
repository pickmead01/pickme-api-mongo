const express = require("express");
const Banner = require("../model/banner");
const multer = require("multer");
const sharp = require("sharp");
const fs = require("fs");
const slugify = require("slugify");
const logChanges = require("../logChanges");
const verifyUser = require("../verifyUser");
const url = require("url");
const bannerRouter = new express.Router();
require("dotenv").config();

const LOCAL_DOMAIN = process.env.LOCAL_DOMAIN;
const BANNER_CONTENT_PATH = process.env.BANNER_CONTENT_PATH;
const BANNER_HOMEPAGE_PATH = process.env.BANNER_HOMEPAGE_PATH;
const BANNER_DISPLAY_LIMIT = process.env.BANNER_DISPLAY_LIMIT;

async function getMaxSerialNumber() {
  const maxSerialNumberBanner = await Banner.findOne()
    .sort({ serialNumber: -1 })
    .select("-_id serialNumber");
  return maxSerialNumberBanner ? maxSerialNumberBanner.serialNumber : 0;
}

function parseRequestBody(req, res, next) {
  const {
    name,
    sort,
    hyperlink,
    remark,
    eternal,
    display,
    startDate,
    endDate,
  } = req.body;
  if (req.method === "POST") {
    res.name = name !== undefined ? JSON.parse(name) : null;
    res.sort = sort !== undefined ? JSON.parse(sort) : null;
    res.hyperlink = hyperlink !== undefined ? JSON.parse(hyperlink) : null;
    res.remark = remark !== undefined ? JSON.parse(remark) : null;
    res.eternal = eternal !== undefined ? JSON.parse(eternal) : false;
    res.display = display !== undefined ? JSON.parse(display) : false;
    res.startDate =
      startDate !== undefined ? new Date(JSON.parse(startDate)) : null;
    res.endDate = endDate !== undefined ? new Date(JSON.parse(endDate)) : null;
  }
  if (req.method === "PATCH") {
    res.name =
      name === undefined ? undefined : name === null ? null : JSON.parse(name);
    res.sort =
      sort === undefined ? undefined : sort === null ? null : JSON.parse(sort);
    res.hyperlink =
      hyperlink === undefined
        ? undefined
        : hyperlink === null
        ? null
        : JSON.parse(hyperlink);
    res.remark =
      remark === undefined
        ? undefined
        : remark === null
        ? null
        : JSON.parse(remark);
    res.eternal =
      eternal === undefined
        ? undefined
        : eternal === null
        ? false
        : JSON.parse(eternal);
    res.display =
      display === undefined
        ? undefined
        : display === null
        ? false
        : JSON.parse(display);
    res.startDate =
      startDate === undefined
        ? undefined
        : startDate === null
        ? null
        : new Date(JSON.parse(startDate));
    res.endDate =
      endDate === undefined
        ? undefined
        : endDate === null
        ? null
        : new Date(JSON.parse(endDate));
  }
  next();
}

function isPositiveInteger(input) {
  return typeof input === "number" && Number.isInteger(input) && input >= 0;
}

function parseQuery(req, res, next) {
  let pageNumber = req.query.pageNumber;
  let limit = req.query.limit;

  if (pageNumber !== undefined) {
    pageNumber = parseInt(pageNumber, 10);

    if (!isPositiveInteger(pageNumber)) {
      return res.status(400).send({
        message: "Invalid pageNumber. It must be a positive integer.",
      });
    }
  }

  if (limit !== undefined) {
    limit = parseInt(limit, 10);
    if (!isPositiveInteger(limit)) {
      return res.status(400).send({
        message: "Invalid limit. It must be a positive integer.",
      });
    }
  }

  req.pageNumber = pageNumber;
  req.limit = limit;
  next();
}

function uploadImage() {
  const storage = multer.memoryStorage();
  const upload = multer({
    storage: storage,
    limits: {
      fileSize: 10000000, //maximim size 10MB
      fieldSize: 10 * 1024 * 1024,
    },
  });
  // return upload.single("homeImagePath");
  return upload.fields([
    { name: "homeImagePath", maxCount: 1 },
    { name: "contentImagePath", maxCount: 1 },
  ]);
}

async function processImage(file, originalFilename) {
  console.log("🔥 processImage PATHS:", {
    IMG_CONTENT_PATH,
    IMG_HOMEPAGE_PATH,
    CWD: process.cwd()
  });
  console.log("🔥 writing file:", originalFilename);

  // console.log(file);
  if (!file || !originalFilename) {
    // If there is no file or originalFilename, return null
    return null;
  }
  if (file.mimetype.startsWith("text/")) {
    return file.buffer.toString("utf-8");
  } else if (file.mimetype.startsWith("image/")) {
    // compress image using sharp
    const compressedImage = await sharp(file.buffer)
      // .resize(942, 365, { fit: "inside", withoutEnlargement: true })
      .toBuffer({
        resolveWithObject: true,
        quality: 100,
      });

    const compressedImage2 = await sharp(file.buffer)
      .resize(450, 300, { fit: "inside", withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true, quality: 70 });

    const extension = originalFilename.substring(
      originalFilename.lastIndexOf(".")
    );
    const filenameWithoutExtension = originalFilename.substring(
      0,
      originalFilename.lastIndexOf(".")
    );
    const newFilename =
      slugify(filenameWithoutExtension, {
        replacement: "-", // replace spaces with replacement character, defaults to `-`
        remove: /[^a-zA-Z0-9]/g, // remove characters that match regex, defaults to `undefined`
        lower: true, // convert to lower case, defaults to `false`
        strict: false, // strip special characters except replacement, defaults to `false`
        trim: true, // trim leading and trailing replacement chars, defaults to `true`
      }) +
      "-" +
      Date.now() +
      extension;
      
    console.log("🔥 trying to save to:", `${IMG_CONTENT_PATH}/${newFilename}`);

    fs.writeFileSync(
      `${BANNER_CONTENT_PATH}/${newFilename}`,
      compressedImage.data
    );
    fs.writeFileSync(
      `${BANNER_HOMEPAGE_PATH}/${newFilename}`,
      compressedImage2.data
    );
    return newFilename;
  } else {
    return null;
  }
}

async function getBanner(req, res, next) {
  const id = req.params.id;
  let banner;
  try {
    banner = await Banner.findById(id);
    if (banner == undefined) {
      return res.status(404).json({ message: "can't find banner!" });
    }
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
  res.banner = banner;
  next();
}
bannerRouter.get("/banner/frontEnd", async (req, res) => {
  try {
    //取得需要發布的名單
    const bannerList = await Banner.find({
      display: true,
      status: "進行中",
      sort: {
        $exists: true,
        $ne: null,
        $ne: "",
      },
    })
      .select("name sort hyperlink contentImagePath")
      .sort({ sort: 1 })
      .limit(BANNER_DISPLAY_LIMIT);

    const totalDocs = await Banner.countDocuments({
      display: true,
      status: "進行中",
      sort: {
        $exists: true,
        $ne: null,
        $ne: "",
      },
    }).exec();
    const result = {
      data: bannerList,
      totalCount: totalDocs,
      limit: BANNER_DISPLAY_LIMIT,
    };

    res.status(200).send(result);
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});
// const startDate = new Date("2023-07-27T00:00:00.000Z");
// const endDate = new Date("2023-08-31T00:00:00.000Z");

// const startTimeStamp = startDate.getTime();
// const endTimeStamp = endDate.getTime();

// console.log("Start TimeStamp:", startTimeStamp); // 輸出2023-08-01的時間戳
// console.log("End TimeStamp:", endTimeStamp); // 輸出2023-08-31的時間戳
bannerRouter.get(
  "/banner/dashboard",
  verifyUser,
  parseQuery,
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const { pageNumber, limit } = req;
      const { status, display, name } = req.query;
      const skip = pageNumber ? (pageNumber - 1) * limit : 0;
      //   const nameQuery = req.query.name;
      const query = {};

      let start;
      let end;

      if (startDate) {
        start = new Date(Number(startDate));
        if (isNaN(start)) {
          res.status(400).send({
            message:
              "Invalid startDate. It must be a valid date format or a timestamp.",
          });
          return;
        }
      }

      if (endDate) {
        end = new Date(Number(endDate));
        if (isNaN(end)) {
          res.status(400).send({
            message:
              "Invalid endDate. It must be a valid date format or a timestamp.",
          });
          return;
        }
      }
      if (end && start && end <= start) {
        res.status(400).send({
          message: "End date cannot be smaller than or equal to start date.",
        });
        return;
      }
      if (startDate && endDate) {
        query.$or = [
          { startDate: { $gte: start, $lte: end } },
          { endDate: { $gte: start, $lte: end } },
          { startDate: { $lte: start }, endDate: { $gte: end } },
          { eternal: true },
        ];
      } else if (startDate && !endDate) {
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(start.getDate() + 1);
        query.$or = [
          { startDate: { $gte: start, $lt: end } },
          { endDate: { $gte: start, $lt: end } },
          { eternal: true },
        ];
      } else if (!startDate && endDate) {
        end.setUTCHours(0, 0, 0, 0);
        start = new Date(end);
        start.setDate(end.getDate() - 1);
        query.$or = [
          { startDate: { $gte: start, $lt: end } },
          { endDate: { $gte: start, $lt: end } },
          { eternal: true },
        ];
      }

      if (name) {
        const namesArray = name.split(",");
        const nameQueries = namesArray.map((name) => ({
          title: { $regex: name, $options: "i" },
        }));
        query.$or = nameQueries;
      }

      switch (status) {
        case "已排程":
          query.status = "已排程";
          break;
        case "進行中":
          query.status = "進行中";
          break;
        case "下架":
          query.status = "下架";
          break;
      }

      switch (display) {
        case 1:
          query.display = true;
          break;
        case 0:
          query.display = false;
          break;
      }
      const bannersQuery = Banner.find(query)
        .sort({ serialNumber: 1 })
        .select("-__v");

      if (limit && limit > 0) {
        bannersQuery.skip(skip).limit(limit);
      }

      let banners = await bannersQuery;

      const totalDocs = await Banner.countDocuments(query).exec();

      const result = {
        data: banners,
        totalCount: totalDocs,
        totalPages: limit > 0 ? Math.ceil(totalDocs / limit) : 1,
        limit: limit,
        currentPage: pageNumber,
      };

      res.status(200).send(result);
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

bannerRouter.get("/banner/:id", verifyUser, async (req, res) => {
  try {
    const id = req.params.id;
    const banner = await Banner.findById(id).select("-__v");
    if (!banner) {
      res.status(404).send("Banner can not found");
    }
    res.status(200).send(banner);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

bannerRouter.patch("/banner/checkScheduleBanners", async (req, res) => {
  //取得當前時間區間
  let now = new Date();
  let oneHourAgo = new Date();
  oneHourAgo.setTime(oneHourAgo.getTime() - 1 * 60 * 60 * 1000);
  try {
    //取得需要發布以及到期的名單
    const bannerList = await Banner.find({
      $or: [
        {
          status: "已排程",
          $and: [
            { startDate: { $exists: true } },
            { startDate: { $ne: null } },
            { startDate: { $ne: "" } },
            { startDate: { $gte: now } },
          ],
        },
        {
          status: "進行中",
          $and: [
            { endDate: { $exists: true } },
            { endDate: { $ne: null } },
            { endDate: { $ne: "" } },
            { endDate: { $lte: now } },
          ],
        },
      ],
    }).select("serialNumber display status");

    let updateCount = 0;
    let updatedIds = [];
    for (let banner of bannerList) {
      if (banner.status === "已排程") {
        banner.display = true;
        await banner.save();
        updateCount++;
        updatedIds.push(banner.serialNumber);
      } else {
        banner.display = false;
        await banner.save();
        updateCount++;
        updatedIds.push(banner.serialNumber);
      }
    }
    if (updateCount === 0) {
      res.status(200).send({
        message: "No scheduled banner need to update status",
      });
    } else {
      res.status(200).send({
        message: `Successfully updated the following serialNumbers: ${updatedIds.join(
          ", "
        )}`,
      });
    }
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

bannerRouter.patch(
  "/banner/:id",
  verifyUser,
  uploadImage(),
  parseRequestBody,
  getBanner,
  async (req, res) => {
    const {
      name,
      sort,
      hyperlink,
      remark,
      eternal,
      display,
      startDate,
      endDate,
    } = res;

    const contentImagePath =
      req.files.contentImagePath && req.files.contentImagePath[0];
    const homeImagePath = req.files.homeImagePath && req.files.homeImagePath[0];

    const contentFilename = contentImagePath
      ? await processImage(contentImagePath, contentImagePath.originalname)
      : undefined;

    const homeFilename = homeImagePath
      ? await processImage(homeImagePath, homeImagePath.originalname)
      : undefined;

    if (contentFilename !== undefined) {
      if (homeImagePath) {
        res.banner.homeImagePath = homeFilename;
        const regex = /src="(https:\/\/www\.youtube\.com\/embed\/[^"]+)"/;
        const match = contentFilename.match(regex);

        if (match && match[1]) {
          const youtubeUrl = match[1];
          res.banner.contentImagePath = youtubeUrl;
        }
      } else {
        res.banner.homeImagePath = `${LOCAL_DOMAIN}home/saved_image/banner/homepage/${contentFilename}`;
        res.banner.contentImagePath = `${LOCAL_DOMAIN}home/saved_image/banner/content/${contentFilename}`;
      }
    }

    if (name !== undefined) res.banner.name = name;
    if (hyperlink !== undefined) res.banner.hyperlink = hyperlink;
    if (remark !== undefined) res.banner.remark = remark;
    if (eternal !== undefined) res.banner.eternal = eternal;
    if (display !== undefined) res.banner.display = display;
    if (startDate !== undefined) res.banner.startDate = startDate;
    if (endDate !== undefined) res.banner.endDate = endDate;
    if (sort !== undefined) res.banner.sort = sort;

    try {
      await logChanges(
        req.method,
        req.path,
        res.banner,
        Banner,
        "banner",
        req.session.user,
        true
      );
      await res.banner.save();
      res.status(201).send({ message: "Banner update successfully" });
    } catch (err) {
      res.status(400).send({ message: err.message });
    }
  }
);

bannerRouter.post(
  "/banner",
  verifyUser,
  uploadImage(),
  parseRequestBody,
  async (req, res) => {
    const { name, hyperlink, remark, eternal, display, startDate, endDate } =
      res;
    let sort = res.sort;
    //檢查結束時間是否大於開始時間
    const serialNumber = await getMaxSerialNumber();
    let contentImagePath =
      req.files && req.files.contentImagePath && req.files.contentImagePath[0];
    let homeImagePath =
      req.files && req.files.homeImagePath && req.files.homeImagePath[0];

    sort = parseInt(sort, 10);
    let message = "";
    if (!req.files) {
      message += "Picture or Video is required\n";
    }
    if (name === null) {
      message += "name is required\n";
    }
    if (sort === null) {
      message += "sort is required\n";
    }
    if (!isPositiveInteger(sort)) {
      message += "sort must be a positive integer\n";
    }
    //如果eternal=true就不檢查
    if (startDate >= endDate && eternal === false) {
      message += "startDate cannot be greater than endDate.\n";
    }
    if (message) {
      res.status(400).send({ message });
    } else {
      try {
        const newBannerData = {
          serialNumber: serialNumber + 1,
          name,
          sort,
          hyperlink,
          remark,
          eternal,
          display,
          startDate,
          endDate,
        };

        if (contentImagePath === undefined && homeImagePath === undefined) {
          newBannerData.contentImagePath = null;
          newBannerData.homeImagePath = null;
        } else {
          const contentFilename = contentImagePath
            ? await processImage(
                contentImagePath,
                contentImagePath.originalname
              )
            : null;

          const homeFilename = homeImagePath
            ? await processImage(homeImagePath, homeImagePath.originalname)
            : null;
          if (homeImagePath && homeFilename.startsWith("http")) {
            newBannerData.homeImagePath = homeFilename;
            const regex = /src="(https:\/\/www\.youtube\.com\/embed\/[^"]+)"/;
            const match = contentFilename.match(regex);

            if (match && match[1]) {
              const youtubeUrl = match[1];
              newBannerData.contentImagePath = youtubeUrl;
            }
          } else {
            newBannerData.homeImagePath = `${LOCAL_DOMAIN}home/saved_image/banner/homepage/${contentFilename}`;
            newBannerData.contentImagePath = `${LOCAL_DOMAIN}home/saved_image/banner/content/${contentFilename}`;
          }
        }
        const newBanner = new Banner(newBannerData);
        await newBanner.save();

        await logChanges(
          req.method,
          req.path,
          newBanner,
          Banner,
          "banner",
          req.session.user
        );

        res.status(201).json({ newBanner });
      } catch (err) {
        res.status(400).json({ message: err.message });
      }
    }
  }
);

bannerRouter.delete("/banner/bunchDeleteByIds", async (req, res) => {
  // {"ids": [ "649176aec86c26cc163540a0"]}
  try {
    const ids = req.body.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "Invalid data." });
    }
    const existingBanners = await Banner.find({ _id: { $in: ids } });

    if (existingBanners.length !== ids.length) {
      return res
        .status(400)
        .json({ message: "Some of the provided Banner IDs do not exist." });
    }

    for (let doc of existingBanners) {
      if (doc.contentImagePath.startsWith("<iframe")) {
        //Do nothing
      } else {
        // Delete contentImagePath
        let contentImagePath = url.parse(doc.contentImagePath).path;
        let homeImagePath = url.parse(doc.homeImagePath).path;

        fs.unlink(contentImagePath, (err) => {
          if (err) {
            console.log(
              `Error remove file ${contentImagePath}: ${err.message}`
            );
          } else {
            console.log(`File ${doc.contentImagePath} was deleted`);
          }
        });
        fs.unlink(homeImagePath, (err) => {
          if (err) {
            console.log(`Error remove file ${homeImagePath}: ${err.message}`);
          } else {
            console.log(`File ${doc.homeImagePath} was deleted`);
          }
        });
      }
    }

    await logChanges(
      req.method,
      req.path,
      existingBanners,
      Banner,
      "banner",
      req.session.user,
      true
    );
    const deleteBanners = await Banner.deleteMany({
      _id: { $in: ids },
    });
    if (deleteBanners.deletedCount === 0) {
      return res.status(404).json({ message: "No matching Banner found" });
    }
    // Get all remaining banners and sort by serialNumber
    const remainingBanners = await Banner.find().sort({ serialNumber: 1 });

    // Update serialNumber for remaining banners
    for (let i = 0; i < remainingBanners.length; i++) {
      remainingBanners[i].serialNumber = i + 1;
      await remainingBanners[i].save();
    }
    res.status(201).json({
      message: `Deleted ${deleteBanners.deletedCount} banners successfully!`,
    });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

module.exports = bannerRouter;

const express = require("express");
const Editor = require("../model/editor");
const Sitemap = require("../model/sitemap");
const Categories = require("../model/categories");
const Tags = require("../model/tags");
const tempEditor = require("../model/tempEditor");
const draftEditor = require("../model/draftEditor");
const Ips = require("../model/ip");
const Log = require("../model/changeLog");
const multer = require("multer");
const sharp = require("sharp");
const fs = require("fs");
const slugify = require("slugify");
const escapeHtml = require("escape-html");
const { Text } = require("slate");
const path = require("path");
const url = require("url");
const requestIp = require("request-ip");
const logChanges = require("../logChanges");
const verifyUser = require("../verifyUser");
const { setCache, getCache, scanAndDelete } = require("../redisCache");
const { pipeline } = require("stream");
const { promisify } = require("util");
const pipelineAsync = promisify(pipeline);
const { Readable } = require("stream");
require("dotenv").config();

const editorRouter = new express.Router();

const domain = process.env.DOMAIN;
const SUB_DOMAIN = process.env.SUB_DOMAIN;
const LOCAL_DOMAIN = process.env.LOCAL_DOMAIN;
const IMG_CONTENT_PATH = process.env.IMG_CONTENT_PATH;
const IMG_HOMEPAGE_PATH = process.env.IMG_HOMEPAGE_PATH;
const DBLOG_FILE_PATH = process.env.DBLOG_FILE_PATH;

//set session verify
function getIpInfo(req, res, next) {
  const clientIp = requestIp.getClientIp(req);
  res.clientIp = clientIp;
  next();
}
function parseRequestBody(req, res, next) {
  const {
    headTitle,
    headKeyword,
    headDescription,
    title,
    manualUrl,
    altText,
    hidden,
    topSorting,
    popularSorting,
    recommendSorting,
    scheduledAt,
    draft,
    htmlContent,
  } = req.body;
  if (req.method === "POST") {
    res.headTitle = headTitle !== undefined ? JSON.parse(headTitle) : null;
    res.headKeyword =
      headKeyword !== undefined ? JSON.parse(headKeyword) : null;
    res.headDescription =
      headDescription !== undefined ? JSON.parse(headDescription) : null;
    res.altText = altText !== undefined ? JSON.parse(altText) : null;
    res.title = title !== undefined ? JSON.parse(title) : null;
    res.topSorting = topSorting !== undefined ? JSON.parse(topSorting) : null;
    res.hidden = hidden !== undefined ? JSON.parse(hidden) : false;
    res.popularSorting =
      popularSorting !== undefined ? JSON.parse(popularSorting) : null;
    res.recommendSorting =
      recommendSorting !== undefined ? JSON.parse(recommendSorting) : null;
    res.manualUrl = manualUrl !== undefined ? JSON.parse(manualUrl) : null;
    res.scheduledAt =
      scheduledAt !== undefined ? new Date(JSON.parse(scheduledAt)) : null;
    res.draft = draft !== undefined ? JSON.parse(draft) : false;
    res.htmlContent =
      htmlContent !== undefined ? JSON.parse(htmlContent) : null;
  }
  if (req.method === "PATCH") {
    res.headTitle =
      headTitle === undefined
        ? undefined
        : headTitle === null
        ? null
        : JSON.parse(headTitle);
    res.headKeyword =
      headKeyword === undefined
        ? undefined
        : headKeyword === null
        ? null
        : JSON.parse(headKeyword);
    res.headDescription =
      headDescription === undefined
        ? undefined
        : headDescription === null
        ? null
        : JSON.parse(headDescription);
    res.title =
      title === undefined
        ? undefined
        : title === null
        ? null
        : JSON.parse(title);
    res.manualUrl =
      manualUrl === undefined
        ? undefined
        : manualUrl === null
        ? null
        : JSON.parse(manualUrl);
    res.altText =
      altText === undefined
        ? undefined
        : altText === null
        ? null
        : JSON.parse(altText);
    res.hidden =
      hidden === undefined
        ? undefined
        : hidden === null
        ? false
        : JSON.parse(hidden);
    if (scheduledAt === undefined) {
      res.scheduledAt = undefined;
    } else {
      let parsedScheduledAt = JSON.parse(scheduledAt);

      // 如果parsedScheduledAt是 {"scheduledAt": null}
      if (
        typeof parsedScheduledAt === "object" &&
        parsedScheduledAt.scheduledAt === null
      ) {
        res.scheduledAt = null;
      } else {
        // 在其他情況下，假設 parsedScheduledAt 是一個可以被轉換為日期的值
        res.scheduledAt = new Date(parsedScheduledAt);
      }
    }
    res.draft =
      draft === undefined
        ? undefined
        : draft === false
        ? false
        : JSON.parse(draft);
    res.htmlContent =
      htmlContent === undefined
        ? undefined
        : htmlContent === null
        ? null
        : JSON.parse(htmlContent);
  }
  next();
}

async function getMaxSerialNumber() {
  const [maxSerialNumberEditor, maxSerialNumberDraftEditor] = await Promise.all(
    [
      Editor.findOne().sort({ serialNumber: -1 }).select("-_id serialNumber"),
      draftEditor
        .findOne()
        .sort({ serialNumber: -1 })
        .select("-_id serialNumber"),
    ]
  );

  const maxEditorSerialNumber = maxSerialNumberEditor
    ? maxSerialNumberEditor.serialNumber
    : 0;
  const maxDraftEditorSerialNumber = maxSerialNumberDraftEditor
    ? maxSerialNumberDraftEditor.serialNumber
    : 0;

  return Math.max(maxEditorSerialNumber, maxDraftEditorSerialNumber);
}

async function parseCategories(req, res, next) {
  try {
    let categoryJsonString = req.body.categories;
    let categories;
    if (req.method === "POST") {
      categories =
        categoryJsonString !== undefined
          ? JSON.parse(categoryJsonString)
          : null;
    }
    if (req.method === "PATCH") {
      categories =
        categoryJsonString === undefined
          ? undefined
          : categoryJsonString === null
          ? null
          : JSON.parse(categoryJsonString);
    }
    //分類為空值時因JSON stringtify的關係會被轉成字串null
    if (categories === undefined) {
      res.categories = undefined;
      return next();
    } else if (categories === null) {
      const findUncategorized = await Categories.findOne({
        name: "未分類",
      }).select("_id name");
      res.categories = findUncategorized;
      return next();
    }

    if (!(categories instanceof Array)) {
      throw new Error("Invalid input: categories must be an array");
    }
    if (categories.length > 1) {
      throw new Error("Invalid input: cannot over one category");
    }

    const categoriesMap = new Map();

    for (const category of categories) {
      if (!categoriesMap.has(category.name)) {
        const existingCategory = await Categories.findOne({
          name: category.name,
        });

        if (existingCategory) {
          categoriesMap.set(category.name, existingCategory._id);
        } else {
          throw new Error("Category name error");
        }
      }
    }
    const categoriesArray = categories.map((category) =>
      categoriesMap.get(category.name)
    );

    res.categories = categoriesArray;
    next();
  } catch (error) {
    res.status(400).send({ message: error.message });
  }
}

async function parseTags(req, res, next) {
  try {
    let tagJsonString = req.body.tags;
    let tags;
    if (req.method === "POST") {
      tags = tagJsonString !== undefined ? JSON.parse(tagJsonString) : null;
    }
    if (req.method === "PATCH") {
      tags =
        tagJsonString === undefined
          ? undefined
          : tagJsonString === null
          ? null
          : JSON.parse(tagJsonString);
    }

    if (tags === null) {
      res.tags = [];
      return next();
    } else if (tags === undefined) {
      res.tags = undefined;
      return next();
    }

    if (!(tags instanceof Array)) {
      throw new Error("Invalid input: tags must be an array");
    }

    const tagsMap = new Map();

    for (const tag of tags) {
      if (tag.__isNew__ === true) {
        const newTagUrl = `${SUB_DOMAIN}tag_${tag.name}.html`;
        const newTag = new Tags({
          name: tag.name,
          originalUrl: newTagUrl,
        });
        await newTag.save();
        tagsMap.set(tag.name, newTag._id);

        const newTagSitemap = new Sitemap({
          url: newTagUrl,
          originalID: newTag._id,
          type: "tag",
        });
        await newTagSitemap.save();
      } else {
        if (!tagsMap.has(tag.name)) {
          const existingTag = await Tags.findOne({ name: tag.name });

          if (existingTag) {
            tagsMap.set(tag.name, existingTag._id);
          } else {
            throw new Error("Tag name error");
          }
        }
      }
    }

    const tagsArray = tags.map((tag) => tagsMap.get(tag.name));

    res.tags = tagsArray;
    next();
  } catch (error) {
    res.status(400).send({ message: error.message });
  }
}

function parseHTML(req, res, next) {
  const contentJsonString = req.body.content;
  if (req.method === "PATCH" && !contentJsonString) {
    res.content = undefined;
    next();
    return;
  }
  if (!contentJsonString) {
    res.content = "";
    next();
    return;
  }
  const content = JSON.parse(contentJsonString);

  const serialize = (node) => {
    if (Text.isText(node)) {
      let string = escapeHtml(node.text);
      let textStyle = "";
      if (node.bold) {
        string = `<strong>${string}</strong>`;
      }
      if (node.hide) {
        string = `<span style="display: none;">${string}</span>`;
      }
      if (node.italic) {
        string = `<em>${string}</em>`;
      }
      if (node.underline) {
        string = `<span style="text-decoration: underline;">${string}</span>`;
      }
      if (node.code) {
        string = `<code>${string}</code>`;
      }

      if (node.color) {
        textStyle += `color: ${escapeHtml(node.color)};`;
      }
      if (node.backgroundColor) {
        textStyle += `background-color: ${escapeHtml(node.backgroundColor)};`;
      }
      if (textStyle) {
        string = `<span style="${textStyle}">${string}</span>`;
      }
      return string;
    }

    const children = node.children.map((n) => serialize(n)).join("");
    let style = node.hide ? "display: none;" : "";

    if (node.align === "left") {
      style += "text-align: left;";
    } else if (node.align === "center") {
      style += "text-align: center;";
    } else if (node.align === "right") {
      style += "text-align: right;";
    } else if (node.align === "justify") {
      style += "text-align: justify;";
    }

    const alignmentClasses = {
      left: "left",
      center: "center",
      right: "right",
    };

    let classString = `class="${alignmentClasses[node.alignment] || ""}"`;

    switch (node.type) {
      case "quote":
        return `<blockquote style="${style}"><p>${children}</p></blockquote>`;
      case "paragraph":
        const hasCodeChild = node.children.some((child) => child.code);
        if (hasCodeChild) {
          return `<p class="code" style="${style}">${children}</p>`;
        } else {
          return `<p style="${style}">${children}</p>`;
        }
      case "block-quote":
        return `<blockquote style="${style}">${children}</blockquote>`;
      case "h1":
        return `<h1 style="${style}"><strong>${children}</strong></h1>`;
      case "h2":
        return `<h2 style="${style}"><strong>${children}</strong></h2>`;
      case "h3":
        return `<h3 style="${style}"><strong>${children}</strong></h3>`;
      case "table":
        return `<table ${classString}><tbody>${children}</tbody></table>`;
      case "table-row":
        return `<tr ${classString}>${children}</tr>`;
      case "table-cell":
        return `<td ${classString}>${children}</td>`;
      case "list-item":
        return `<li style="${style}">${children}</li>`;
      case "numbered-list":
        return `<ol style="${style}">${children}</ol>`;
      case "bulleted-list":
        return `<ul style="${style}">${children}</ul>`;
      case "image":
        const hrefAttribute = node.href
          ? `href="${escapeHtml(node.href)}"`
          : "";
        const titleAttribute = node.href
          ? escapeHtml(node.href)
          : escapeHtml(node.alt);
        const srcAttribute = node.url ? `src="${escapeHtml(node.url)}"` : "";
        const altAttribute = node.alt ? `alt="${escapeHtml(node.alt)}"` : "";
        if (node.href) {
          return `<a ${hrefAttribute} title = ${titleAttribute} rel = "noopener noreferrer" target = "_blank"> <img ${srcAttribute} ${altAttribute}>${children}</img></a>`;
        } else {
          return `<img ${srcAttribute} ${altAttribute}>${children}</img>`;
        }
      case "link":
        return `<a target="_blank" rel="noopener noreferrer" href="${escapeHtml(
          node.url
        )}">${children}</a>`;
      case "button":
        const buttonType = node.buttonType
          ? `type="${escapeHtml(node.buttonType)}"`
          : "";
        return `<button ${buttonType}>${children}</button>`;
      case "badge":
        return `<span class="badge">${children}</span>`;
      default:
        return children;
    }
  };
  const htmlContent = content.map(serialize).join("");

  res.content = content;
  res.htmlContent = htmlContent;
  next();
}

//後台編輯熱門文章用
async function getNewPopularEditors() {
  const excludeEditor = await Categories.findOne({ name: "未分類" }).select(
    "_id name"
  );
  // 1. 取 popular 不為空值的文章
  const popularEditorsWithSorting = await Editor.find({
    popularSorting: { $exists: true, $ne: null },
    hidden: false,
    draft: false,
    categories: { $ne: excludeEditor._id },
  }).select(
    "_id serialNumber title publishedAt popularSorting pageView homeImagePath"
  );
  const sortingEditorIds = popularEditorsWithSorting.map(
    (editor) => editor._id
  );

  // 2. 取前五名自然點閱率的熱門文章
  let popularEditors = await Editor.find({
    pageView: { $ne: null },
    hidden: false,
    draft: false,
    _id: { $nin: sortingEditorIds },
    categories: { $ne: excludeEditor._id },
  })
    .sort({ pageView: -1, publishedAt: -1 })
    .limit(6)
    .select(
      "_id serialNumber title publishedAt pageView popularSorting homeImagePath"
    );

  // 使用 map 替換 popularEditors 陣列中的元素
  popularEditors = popularEditors.map((editor, index) => {
    const popularEditor = popularEditorsWithSorting.find(
      (editorWithPageView) => editorWithPageView.popularSorting === index
    );
    return popularEditor || editor;
  });
  const updatePopularEditors = await Promise.all(
    popularEditors.map(async (editor) => {
      const sitemapUrl = await Sitemap.findOne({
        originalID: editor._id,
        type: "editor",
      });
      if (sitemapUrl) {
        editor = editor.toObject(); // convert mongoose document to plain javascript object
        editor.sitemapUrl = sitemapUrl.url; // add url property
      }
      return editor;
    })
  );
  // 傳回新的結果
  return updatePopularEditors;
}

async function getNewUnpopularEditors(skip, limit, name) {
  const excludeEditor = await Categories.findOne({ name: "未分類" }).select(
    "_id name"
  );
  // 1. Get top 5 pageVies data
  const popularEditors = await getNewPopularEditors();
  //2. Get popular editors' _id array
  const popularEditorIds = popularEditors.map((editor) => editor._id);
  const baseQuery = {
    _id: { $nin: popularEditorIds },
    hidden: false,
    draft: false,
    categories: { $ne: excludeEditor._id },
  };

  // Add the title filter if a name is provided
  if (name) {
    baseQuery.title = { $regex: name, $options: "i" };
  }

  // 3. Find all editors that don't have _id in the newPopularEditors array
  const nonPopularEditors = await Editor.find(baseQuery)
    .sort({ pageView: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .select(
      "_id serialNumber title publishedAt popularSorting pageView homeImagePath"
    );
  const updateNonPopularEditors = await Promise.all(
    nonPopularEditors.map(async (editor) => {
      const sitemapUrl = await Sitemap.findOne({
        originalID: editor._id,
        type: "editor",
      });
      if (sitemapUrl) {
        editor = editor.toObject(); // convert mongoose document to plain javascript object
        editor.sitemapUrl = sitemapUrl.url; // add url property
      }
      return editor;
    })
  );

  // 4. Get the total number of documents that don't have _id in the popularEditorIds array
  const totalDocs = await Editor.countDocuments(baseQuery).exec();
  return {
    editors: updateNonPopularEditors,
    totalCount: totalDocs,
  };
}
//* _id
async function getEditor(req, res, next) {
  const id = req.params.id;
  let draft = req.query.draft;
  if (draft !== undefined) {
    draft = parseInt(draft, 10);

    if (!isPositiveInteger(draft) || draft !== 1) {
      return res.status(400).send({
        message: "Invalid draft. It must be a positive integer.",
      });
    }
  }
  let editor;
  try {
    if (draft === 1) {
      editor = await draftEditor
        .findOne({ _id: id })
        .populate({ path: "categories", select: "name" })
        .populate({ path: "tags", select: "name" });
    } else {
      editor = await Editor.findOne({ _id: id })
        .populate({ path: "categories", select: "name" })
        .populate({ path: "tags", select: "name" });
    }
    if (editor == undefined) {
      return res.status(404).json({ message: "can't find editor!" });
    }
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }

  res.editor = editor;
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
    { name: "imageBlob", maxCount: 1 },
  ]);
}

async function processImage(file, originalFilename) {
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
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true, quality: 90 });

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

    fs.writeFileSync(
      `${IMG_CONTENT_PATH}/${newFilename}`,
      compressedImage.data
    );
    fs.writeFileSync(
      `${IMG_HOMEPAGE_PATH}/${newFilename}`,
      compressedImage2.data
    );
    return newFilename;
    // }
  } else {
    return null;
  }
}

const extractFirstParagraph = (htmlContent) => {
  const match = htmlContent.match(/<p.*?>(.*?)<\/p>/);
  return match ? match[1] : "";
};

editorRouter.patch("/updateStatus", async (req, res) => {
  try {
    const updateList = await Editor.find();
    let updateCount = 0;
    for (let editor of updateList) {
      let editorDocument = await Editor.findById(editor._id);

      // 修改它的屬性
      if (["隱藏文章", "已發布"].includes(editorDocument.status)) {
        editorDocument.publishedAt = editorDocument.createdAt;
      }
      await editorDocument.save();
      updateCount++;
    }
    res.status(200).send({ message: `Update ${updateCount} successfully` });

    // const editors = await Editor.find({
    //   originalUrl: { $exists: true, $ne: null },
    // });

    // editors.forEach(async (editor) => {
    //   editor.originalUrl = editor.originalUrl.replace(
    //     "http://10.88.0.103:3000",
    //     "http://10.88.0.103:3001"
    //   );
    //   await editor.save();
    // });
    // res.status(200).send({ message: `Update successfully` });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

editorRouter.post("/editor/verifyUser", verifyUser, (req, res) => {
  res.status(200).json({ message: "User is verified" });
});

//後台編輯文章處顯示用
editorRouter.get("/editor", verifyUser, parseQuery, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { pageNumber, limit } = req;
    const { status } = req.query;
    const skip = pageNumber ? (pageNumber - 1) * limit : 0;

    const titlesQuery = req.query.title;
    const categoriesQuery = req.query.category;

    const query = {};

    let start;
    let end;
    // Try to get data from cache
    const generateCacheKey = (query) => {
      //避免UAT與其他專案衝突
      let objectTypeString = "pickme:editorList";
      for (const [key, value] of Object.entries(query)) {
        objectTypeString += `:${key}:${value}`;
      }
      return objectTypeString;
    };
    const cacheKey = generateCacheKey(req.query);

    const cachedResult = await getCache(cacheKey);
    if (cachedResult) {
      return res.status(200).send(cachedResult);
    }

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

    if (titlesQuery) {
      const titlesArray = titlesQuery.split(",");
      const titleQueries = titlesArray.map((title) => ({
        title: { $regex: title, $options: "i" },
      }));
      query.$or = titleQueries;
    }

    if (categoriesQuery) {
      const category = await Categories.findOne({ name: categoriesQuery });

      if (!category) {
        res.status(400).send({ message: "Invalid category name." });
        return;
      }
      query.categories = category._id;
    }

    if (startDate && endDate) {
      query.createdAt = { $gte: start, $lt: end };
    } else if (startDate) {
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 1);
      query.createdAt = { $gte: start, $lt: end };
    }

    switch (status) {
      case "全部":
        query.status = { $in: ["草稿", "已排程", "已發布"] };
        break;
      case "草稿":
        query.status = "草稿";
        break;
      case "已排程":
        query.status = "已排程";
        break;
      case "隱藏文章":
        query.status = "隱藏文章";
        break;
      case "已發布":
        query.status = "已發布";
        break;
    }

    let editorsQueryEditor;
    let editorsQueryDraftEditor;

    if (status === "全部") {
      editorsQueryEditor = Editor.find({
        ...query,
        status: { $in: ["已排程", "已發布"] },
      })
        .populate({ path: "categories", select: "name" })
        .populate({ path: "tags", select: "name" })
        // .sort({ serialNumber: -1 })
        .select("-content -htmlContent");

      editorsQueryDraftEditor = draftEditor
        .find(query)
        .populate({ path: "categories", select: "name" })
        .populate({ path: "tags", select: "name" })
        // .sort({ updatedAt: -1 })
        .select("-content -htmlContent");
    } else if (status === "草稿") {
      editorsQueryDraftEditor = draftEditor
        .find(query)
        .populate({ path: "categories", select: "name" })
        .populate({ path: "tags", select: "name" })
        // .sort({ updatedAt: -1 })
        .select("-content -htmlContent");
    } else {
      editorsQueryEditor = Editor.find(query)
        .populate({ path: "categories", select: "name" })
        .populate({ path: "tags", select: "name" })
        // .sort({ updatedAt: -1 })
        .select("-content -htmlContent");
    }

    if (limit && limit > 0) {
      if (editorsQueryEditor) {
        editorsQueryEditor.skip(skip).limit(limit);
      }
      if (editorsQueryDraftEditor) {
        editorsQueryDraftEditor.skip(skip).limit(limit);
      }
    }

    let editors = [];
    if (editorsQueryEditor) {
      editors = editors.concat(await editorsQueryEditor);
    }
    if (editorsQueryDraftEditor) {
      editors = editors.concat(await editorsQueryDraftEditor);
    }

    let totalDocs = 0;
    if (status === "全部") {
      totalDocs += await Editor.countDocuments({
        ...query,
        status: { $in: ["已排程", "已發布"] },
      }).exec();
      totalDocs += await draftEditor.countDocuments(query).exec();
    } else if (status === "草稿") {
      totalDocs += await draftEditor.countDocuments(query).exec();
    } else {
      totalDocs += await Editor.countDocuments(query).exec();
    }

    const updateEditor = await Promise.all(
      editors.map(async (editor) => {
        const tagIds = editor.tags ? editor.tags.map((tag) => tag._id) : [];
        //JP站沒有分類
        const categoryID = editor.categories ? editor.categories._id : null;

        const [categorySitemap, tagSitemaps] = await Promise.all([
          categoryID
            ? Sitemap.findOne({ originalID: categoryID, type: "category" })
            : null,
          Sitemap.find({ originalID: { $in: tagIds }, type: "tag" }),
        ]);

        const tagSitemapMap = new Map(
          tagSitemaps.map((sitemap) => [
            sitemap.originalID.toString(),
            sitemap.url,
          ])
        );

        editor = editor.toObject();

        if (categorySitemap) {
          editor.categories = {
            ...editor.categories,
            sitemapUrl: categorySitemap.url,
          };
        }

        editor.tags = editor.tags
          ? editor.tags.map((tag) => ({
              ...tag,
              sitemapUrl: tagSitemapMap.get(tag._id.toString()),
            }))
          : [];

        const editorSitemap = await Sitemap.findOne({
          originalID: editor._id,
          type: "editor",
        });

        if (editorSitemap) {
          editor.sitemapUrl = editorSitemap.url;
        }

        return editor;
      })
    );

    const result = {
      data: updateEditor,
      totalCount: totalDocs,
      totalPages: limit > 0 ? Math.ceil(totalDocs / limit) : 1,
      limit: limit,
      currentPage: pageNumber,
    };

    setCache(cacheKey, result, 60 * 60 * 12);
    res.status(200).send(result);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

editorRouter.get(
  "/editor/adjacentArticle/:id",
  verifyUser,
  async (req, res) => {
    const id = req.params.id;
    try {
      const currentEditor = await Editor.findOne({ _id: id }).select(
        "serialNumber"
      );
      if (!currentEditor) {
        return res.status(404).send({ message: "Editor not found." });
      }

      const minSerialNumber = await Editor.findOne({ hidden: false })
        .sort({ serialNumber: 1 })
        .select("serialNumber");
      const maxSerialNumber = await Editor.findOne({ hidden: false })
        .sort({ serialNumber: -1 })
        .select("serialNumber");

      let previousEditor = null;
      let nextEditor = null;

      for (
        let i = currentEditor.serialNumber - 1;
        i >= minSerialNumber.serialNumber;
        i--
      ) {
        previousEditor = await Editor.findOne({
          serialNumber: i,
          hidden: false,
        }).select("title");

        if (previousEditor) {
          const sitemapUrl = await Sitemap.findOne({
            originalID: previousEditor._id,
            type: "editor",
          });
          if (sitemapUrl) {
            previousEditor = previousEditor.toObject();
            previousEditor.sitemapUrl = sitemapUrl.url;
          }
          break;
        }
      }

      for (
        let i = currentEditor.serialNumber + 1;
        i <= maxSerialNumber.serialNumber;
        i++
      ) {
        nextEditor = await Editor.findOne({
          serialNumber: i,
          hidden: false,
        }).select("title");
        if (nextEditor) {
          const sitemapUrl = await Sitemap.findOne({
            originalID: nextEditor._id,
            type: "editor",
          });
          if (sitemapUrl) {
            nextEditor = nextEditor.toObject();
            nextEditor.sitemapUrl = sitemapUrl.url;
          }
          break;
        }
      }

      res.status(200).json({
        previousEditor: previousEditor,
        nextEditor: nextEditor,
      });
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

//列出前後台熱門文章
editorRouter.get(
  "/editor/popular",
  verifyUser,
  parseQuery,
  async (req, res) => {
    const { pageNumber, limit } = req;
    const { popular: popularQueryParam } = req.query;
    let popular;

    popular = parseInt(popularQueryParam, 10);

    if (isNaN(popular) || popular < 0 || popular > 1) {
      return res.status(400).send({ message: "Invalid popular parameter" });
    }

    const skip = pageNumber ? (pageNumber - 1) * limit : 0;

    try {
      //不論前後台顯示都是只顯示熱門的六筆
      if (popular === 1) {
        const PopularEditors = await getNewPopularEditors();
        const totalDocs = PopularEditors.length;

        const result = {
          data: PopularEditors,
          totalCount: totalDocs,
        };

        return res.status(200).json(result);
      } else if (popular === 0) {
        const { editors: nonPopularEditors, totalCount: totalDocs } =
          await getNewUnpopularEditors(skip, limit);

        const result = {
          data: nonPopularEditors,
          totalCount: totalDocs,
          totalPages: Math.ceil(totalDocs / limit),
          limit: limit,
          currentPage: pageNumber,
        };

        return res.status(200).json(result);
      }
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

//後台搜尋非熱門文章
editorRouter.get(
  "/editor/searchUnpopular/:name",
  verifyUser,
  parseQuery,
  async (req, res) => {
    try {
      // 1. Get top 5 pageVies data
      const name = req.params.name;
      const { pageNumber, limit } = req;
      const skip = pageNumber ? (pageNumber - 1) * limit : 0;

      const { editors: nonPopularEditors, totalCount: totalDocs } =
        await getNewUnpopularEditors(skip, limit, name);

      const result = {
        data: nonPopularEditors,
        totalCount: totalDocs,
        totalPages: Math.ceil(totalDocs / limit),
        limit: limit,
        currentPage: pageNumber,
      };

      res.status(200).send(result);
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

//前後台列出推薦文章
editorRouter.get(
  "/editor/recommend",
  verifyUser,
  parseQuery,
  async (req, res) => {
    const { pageNumber, limit } = req;
    const { recommend: recommendQueryParam } = req.query;
    const { home: homeQueryParam } = req.query;
    let recommend;
    let home;
    let query = {
      status: "已發布",
    };

    if (recommendQueryParam === undefined) {
      recommend = undefined;
      // Do nothing, just pass the control to the next handler
    } else {
      recommend = parseInt(recommendQueryParam, 10);

      if (isNaN(recommend) || recommend < 0 || recommend > 1) {
        return res.status(400).send({ message: "Invalid recommend parameter" });
      }
    }

    if (homeQueryParam === undefined) {
      home = undefined;
      // Do nothing, just pass the control to the next handler
    } else {
      home = parseInt(homeQueryParam, 10);

      if (isNaN(home) || home !== 1) {
        return res.status(400).send({ message: "Invalid home parameter" });
      }
    }

    switch (recommend) {
      case 1:
        query.recommendSorting = { $ne: null };
        break;
      case 0:
        query.recommendSorting = null;
        break;
    }

    const skip = pageNumber ? (pageNumber - 1) * limit : 0;

    try {
      if (home === 1) {
        if (recommend !== undefined) {
          return res.status(400).json({
            message: `Invalid parameter, cannot use "home" and "recommend" parameter in the same time`,
          });
        }
        const allItems = await Editor.aggregate([
          {
            $sort: { publishedAt: -1 },
          },
          {
            $match: {
              $and: [
                { status: "已發布" },
                // { recommendSorting: { $ne: null } },
                // { recommendSorting: { $exists: true } },
              ],
            },
          },
          {
            $addFields: {
              sort: {
                $cond: [
                  { $eq: ["$recommendSorting", null] },
                  Number.MAX_VALUE,
                  "$recommendSorting",
                ],
              },
            },
          },
          {
            $sort: { sort: 1 },
          },
          {
            $facet: {
              data: [
                { $skip: skip },
                { $limit: limit },
                {
                  $project: {
                    serialNumber: 1,
                    title: 1,
                    publishedAt: 1,
                    recommendSorting: 1,
                    homeImagePath: 1,
                  },
                },
              ],
              totalCount: [
                {
                  $count: "count",
                },
              ],
            },
          },
        ]).exec();

        const [{ data, totalCount }] = allItems;
        const totalDocs = totalCount[0] ? totalCount[0].count : 0;
        const updateData = await Promise.all(
          data.map(async (editor) => {
            const sitemapUrl = await Sitemap.findOne({
              originalID: editor._id,
              type: "editor",
            });
            if (sitemapUrl) {
              editor.sitemapUrl = sitemapUrl.url; // add url property
            }
            return editor;
          })
        );

        const result = {
          data: updateData,
          totalCount: totalDocs,
          totalPages: Math.ceil(totalDocs / limit),
          limit: limit,
          currentPage: pageNumber,
        };

        res.status(200).json(result);
      } else {
        const items = await Editor.find(query)
          .sort({ recommendSorting: 1, publishedAt: -1 })
          .skip(skip)
          .limit(limit)
          .select(
            "_id serialNumber title publishedAt recommendSorting homeImagePath"
          )
          .exec();
        const updateItems = await Promise.all(
          items.map(async (editor) => {
            const sitemapUrl = await Sitemap.findOne({
              originalID: editor._id,
              type: "editor",
            });
            if (sitemapUrl) {
              editor = editor.toObject(); // convert mongoose document to plain javascript object
              editor.sitemapUrl = sitemapUrl.url; // add url property
            }
            return editor;
          })
        );

        const totalDocs = await Editor.countDocuments(query).exec();
        const result = {
          data: updateItems,
          totalCount: totalDocs,
          totalPages: Math.ceil(totalDocs / limit),
          limit: limit,
          currentPage: pageNumber,
        };

        res.status(200).json(result);
      }
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

//後台搜尋非推薦文章
editorRouter.get(
  "/editor/searchUnrecommend/:name",
  verifyUser,
  parseQuery,
  async (req, res) => {
    try {
      const name = req.params.name;
      const { pageNumber, limit } = req;
      const skip = pageNumber ? (pageNumber - 1) * limit : 0;

      const aggregation = await Editor.aggregate([
        {
          $match: {
            status: "已發布",
            recommendSorting: null,
            title: { $regex: name, $options: "i" },
          },
        },
        {
          $sort: { publishedAt: -1 },
        },
        {
          $facet: {
            findUnrecommendEditors: [
              { $skip: skip },
              { $limit: limit },
              {
                $project: {
                  serialNumber: 1,
                  title: 1,
                  publishedAt: 1,
                  recommendSorting: 1,
                  homeImagePath: 1,
                },
              },
            ],
            totalCount: [{ $count: "count" }],
          },
        },
      ]);

      const findUnrecommendEditors = aggregation[0].findUnrecommendEditors;
      const updateResult = await Promise.all(
        findUnrecommendEditors.map(async (editor) => {
          const sitemapUrl = await Sitemap.findOne({
            originalID: editor._id,
            type: "editor",
          });
          if (sitemapUrl) {
            // editor = editor.toObject(); // convert mongoose document to plain javascript object
            editor.sitemapUrl = sitemapUrl.url; // add url property
          }
          return editor;
        })
      );
      const totalDocs =
        aggregation[0].totalCount.length > 0
          ? aggregation[0].totalCount[0].count
          : 0;

      const result = {
        data: updateResult,
        totalCount: totalDocs,
        totalPages: Math.ceil(totalDocs / limit),
        limit: limit,
        currentPage: pageNumber,
      };

      res.status(200).send(result);
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

//前後台列出置頂與最新文章
editorRouter.get(
  "/editor/topAndNews",
  verifyUser,
  parseQuery,
  async (req, res) => {
    const { pageNumber, limit } = req;
    const { top: topQueryParam } = req.query;
    const { home: homeQueryParam } = req.query;

    // const skip = (pageNumber - 1) * limit;
    let top;
    let home;
    let query = { status: "已發布" };

    if (topQueryParam === undefined) {
      top = undefined;
      // Do nothing, just pass the control to the next handler
    } else {
      top = parseInt(topQueryParam, 10);

      if (isNaN(top) || top < 0 || top > 1) {
        return res.status(400).send({ message: "Invalid top parameter" });
      }
    }

    if (homeQueryParam === undefined) {
      home = undefined;
      // Do nothing, just pass the control to the next handler
    } else {
      home = parseInt(homeQueryParam, 10);

      if (isNaN(home) || home !== 1) {
        return res.status(400).send({ message: "Invalid home parameter" });
      }
    }

    switch (top) {
      case 1:
        query.topSorting = { $ne: null };
        break;
      case 0:
        query.topSorting = null;
        break;
    }

    const skip = pageNumber ? (pageNumber - 1) * limit : 0;

    try {
      if (home === 1) {
        if (top !== undefined) {
          return res.status(400).json({
            message: `Invalid parameter, cannot use "home" and "recommend" parameter in the same time`,
          });
        }
        const allItems = await Editor.aggregate([
          {
            $sort: { publishedAt: -1 },
          },
          {
            $match: {
              status: "已發布",
            },
          },
          {
            $addFields: {
              sortTop: {
                $cond: [
                  { $eq: ["$topSorting", null] },
                  Number.MAX_VALUE,
                  "$topSorting",
                ],
              },
            },
          },
          {
            $sort: { sortTop: 1 },
          },
          {
            $facet: {
              data: [
                { $skip: skip },
                { $limit: limit },
                {
                  $project: {
                    serialNumber: 1,
                    title: 1,
                    publishedAt: 1,
                    topSorting: 1,
                    homeImagePath: 1,
                  },
                },
              ],
              totalCount: [
                {
                  $count: "count",
                },
              ],
            },
          },
        ]).exec();

        const [{ data, totalCount }] = allItems;
        const updateData = await Promise.all(
          data.map(async (editor) => {
            const sitemapUrl = await Sitemap.findOne({
              originalID: editor._id,
              type: "editor",
            });
            if (sitemapUrl) {
              editor.sitemapUrl = sitemapUrl.url; // add url property
            }
            return editor;
          })
        );

        const totalDocs = totalCount[0] ? totalCount[0].count : 0;

        const result = {
          data: updateData,
          totalCount: totalDocs,
          totalPages: Math.ceil(totalDocs / limit),
          limit: limit,
          currentPage: pageNumber,
        };

        res.status(200).json(result);
      } else {
        const items = await Editor.find(query)
          .sort({ topSorting: 1, publishedAt: -1 })
          .skip(skip)
          .limit(limit)
          .select("_id serialNumber title publishedAt topSorting homeImagePath")
          .exec();

        const totalDocs = await Editor.countDocuments(query).exec();
        const updateItems = await Promise.all(
          items.map(async (editor) => {
            const sitemapUrl = await Sitemap.findOne({
              originalID: editor._id,
              type: "editor",
            });
            if (sitemapUrl) {
              editor = editor.toObject(); // convert mongoose document to plain javascript object
              editor.sitemapUrl = sitemapUrl.url; // add url property
            }
            return editor;
          })
        );

        const result = {
          data: updateItems,
          totalCount: totalDocs,
          totalPages: Math.ceil(totalDocs / limit),
          limit: limit,
          currentPage: pageNumber,
        };

        res.status(200).json(result);
      }
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

//後台搜尋非置頂文章
editorRouter.get(
  "/editor/searchUntop/:name",
  verifyUser,
  parseQuery,
  async (req, res) => {
    try {
      const name = req.params.name;
      const { pageNumber, limit } = req;
      const skip = pageNumber ? (pageNumber - 1) * limit : 0;

      const aggregation = await Editor.aggregate([
        {
          $match: {
            status: "已發布",
            topSorting: null,
            title: { $regex: name, $options: "i" },
          },
        },
        {
          $sort: { publishedAt: -1 },
        },
        {
          $facet: {
            findUntopEditors: [
              { $skip: skip },
              { $limit: limit },
              {
                $project: {
                  serialNumber: 1,
                  title: 1,
                  publishedAt: 1,
                  topdSorting: 1,
                  homeImagePath: 1,
                },
              },
            ],
            totalCount: [{ $count: "count" }],
          },
        },
      ]);

      const findUntopEditors = aggregation[0].findUntopEditors;
      const updateResult = await Promise.all(
        findUntopEditors.map(async (editor) => {
          const sitemapUrl = await Sitemap.findOne({
            originalID: editor._id,
            type: "editor",
          });
          if (sitemapUrl) {
            // editor = editor.toObject(); // convert mongoose document to plain javascript object
            editor.sitemapUrl = sitemapUrl.url; // add url property
          }
          return editor;
        })
      );
      const totalDocs =
        aggregation[0].totalCount.length > 0
          ? aggregation[0].totalCount[0].count
          : 0;

      const result = {
        data: updateResult,
        totalCount: totalDocs,
        totalPages: Math.ceil(totalDocs / limit),
        limit: limit,
        currentPage: pageNumber,
      };

      res.send(result);
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);
// 後台編輯文章用 *get only title & _id field
editorRouter.get("/editor/title", verifyUser, async (req, res) => {
  try {
    const editor = await Editor.find().select("title updatedAt");
    // .limit(10)
    res.send(editor);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

editorRouter.get(
  "/editor/relatedArticles/:id",
  verifyUser,
  async (req, res) => {
    try {
      const targetArticleId = req.params.id;
      const targetArticle = await Editor.findOne({
        _id: targetArticleId,
      }).select("tags");
      const targetTags = targetArticle.tags;

      const relatedArticles = await Editor.find({
        tags: { $in: targetTags },
        _id: { $ne: targetArticleId },
        statius: "已發布",
      })
        .select(
          "title tags publishedAt hidden homeImagePath categories altText"
        )
        .populate({ path: "tags", select: "name" })
        .populate({ path: "categories", select: "name" });
      relatedArticles.forEach((article) => {
        let commonTagsCount = 0;
        article.tags.forEach((tag) => {
          if (targetTags.includes(tag._id.toString())) {
            commonTagsCount++;
          }
        });
        article._doc.commonTagsCount = commonTagsCount;
      });

      // Sort related articles by the number of common tags in descending order
      relatedArticles.sort((a, b) => {
        if (b._doc.commonTagsCount === a._doc.commonTagsCount) {
          return new Date(b.createdAt) - new Date(a.createdAt);
        } else {
          return b._doc.commonTagsCount - a._doc.commonTagsCount;
        }
      });

      const topRelatedArticles = relatedArticles.slice(0, 6);

      const updateRelatedArticles = await Promise.all(
        topRelatedArticles.map(async (editor) => {
          const sitemapUrl = await Sitemap.findOne({
            originalID: editor._id,
            type: "editor",
          });
          if (sitemapUrl) {
            editor = editor.toObject(); // convert mongoose document to plain javascript object
            editor.sitemapUrl = sitemapUrl.url; // add url property
          }
          return editor;
        })
      );

      res.status(200).send({ data: updateRelatedArticles });
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

editorRouter.get(
  "/editor/:id",
  verifyUser,
  getEditor,
  async (req, res, next) => {
    try {
      const sitemapUrl = await Sitemap.findOne({
        originalID: res.editor._id,
        type: "editor",
      });
      if (sitemapUrl) {
        res.editor = res.editor.toObject(); // convert mongoose document to plain javascript object
        res.editor.sitemapUrl = sitemapUrl.url; // add url property
      }

      if (res.editor.categories) {
        const categoriesSitemap = await Sitemap.findOne({
          originalID: res.editor.categories._id,
          type: "category",
        });
        if (categoriesSitemap) {
          res.editor.categories.sitemapUrl = categoriesSitemap.url;
        }
      }

      if (res.editor.tags) {
        res.editor.tags = await Promise.all(
          res.editor.tags.map(async (tag) => {
            const tagsSitemap = await Sitemap.findOne({
              originalID: tag._id,
              type: "tag",
            });
            if (tagsSitemap) {
              tag = { ...tag, sitemapUrl: tagsSitemap.url };
            }
            return tag;
          })
        );
      }
      res.status(200).send(res.editor);
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

editorRouter.get("/tempEditor/:id", verifyUser, async (req, res, next) => {
  const id = req.params.id;

  let editor;
  try {
    editor = await tempEditor.findOne({ _id: id }).select(" -__v");
    if (editor === undefined) {
      return res.status(404).json({ message: "can't find editor!" });
    }
    res.status(200).send(editor);
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
});

editorRouter.get("/domainInfo", verifyUser, async (req, res, next) => {
  try {
    const result = { domain: "http://10.88.0.103:3000" };
    res.status(200).send({ data: result });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
});

//新增文章點擊率
editorRouter.patch(
  "/editor/incrementPageview/:id",
  getEditor,
  getIpInfo,
  async (req, res) => {
    try {
      const editorId = res.editor._id;
      const ip = res.clientIp;

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const existingIp = await Ips.findOne({
        sourceIp: ip,
        relatedId: editorId,
        createdAt: { $gte: oneHourAgo },
      });

      // If the IP has not made a request in the last hour, increment the page view and save the IP
      if (!existingIp) {
        const article = await Editor.findOne({ _id: editorId });
        await Editor.updateOne(
          { _id: editorId },
          { $inc: { pageView: 1 } },
          { timestamps: false }
        );
        await Tags.updateMany(
          { _id: { $in: article.tags } },
          { $inc: { pageView: 1 } }
        );

        const newIp = new Ips({
          sourceIp: ip,
          relatedId: editorId,
        });
        await newIp.save();
        await scanAndDelete();

        res.status(201).json({
          message: `Editor number:${article.serialNumber} page view count incremented`,
        });
      } else {
        res.status(200).json({
          message: `Editor number:${res.editor.serialNumber} page view count not incremented, IP has already made a request in the last hour`,
        });
      }
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  }
);
//熱門文章復原按鈕
editorRouter.patch(
  "/editor/renewPopularEditors",
  verifyUser,
  async (req, res) => {
    try {
      const result = await Editor.updateMany(
        { popularSorting: { $ne: null } },
        { $set: { popularSorting: null } },
        { multi: true }
      );
      const log = new Log({
        httpMethod: "PATCH",
        path: req.path,
        type: "editor",
        userName: req.session.user,
        changes: [
          {
            field: "popularSorting",
            oldValue: "all manual setting value",
            newValue: null,
            changedAt: new Date(),
          },
        ],
      });
      await log.save();

      // 回傳更新筆數
      res.status(201).json({
        message: "Renew popular data successfully",
        totalUpdate: result.modifiedCount,
        matchedCount: result.matchedCount,
      });
    } catch (err) {
      // 如果發生錯誤，回傳錯誤訊息
      res.status(400).json({ message: err.message });
    }
  }
);

//推薦文章後台調整確認按鍵
editorRouter.patch(
  "/editor/recommend/bunchModifiedByIds",
  verifyUser,
  async (req, res) => {
    const ids = req.body.ids;
    let updateCount = 0;
    let failedCount = 0;

    try {
      for (const idObject of ids) {
        const id = Object.keys(idObject)[0];
        const recommendSorting = idObject[id];
        const result = await Editor.updateOne(
          { _id: id },
          { $set: { recommendSorting } }
        );
        if (result.matchedCount === 0) {
          failedCount++;
        }

        if (result.modifiedCount > 0) {
          updateCount++;
        }
      }
      res
        .status(201)
        .send({ updateCount: updateCount, failedCount: failedCount });
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

//置頂文章後台調整確認按鍵
editorRouter.patch(
  "/editor/top/bunchModifiedByIds",
  verifyUser,
  async (req, res) => {
    const ids = req.body.ids;
    let updateCount = 0;
    let failedCount = 0;

    try {
      for (const idObject of ids) {
        const id = Object.keys(idObject)[0];
        const topSorting = idObject[id];
        const result = await Editor.updateOne(
          { _id: id },
          { $set: { topSorting } }
        );
        if (result.matchedCount === 0) {
          failedCount++;
        }

        if (result.modifiedCount > 0) {
          updateCount++;
        }
      }
      res
        .status(201)
        .send({ updateCount: updateCount, failedCount: failedCount });
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

editorRouter.patch("/editor/checkScheduleEditors", async (req, res) => {
  //取得當前時間區間
  let now = new Date();
  let oneHourAgo = new Date();
  oneHourAgo.setTime(oneHourAgo.getTime() - 1 * 60 * 60 * 1000);
  try {
    //取得需要發布的名單
    const listEditor = await Editor.find({
      hidden: true,
      status: "已排程",
      scheduledAt: {
        $exists: true,
        $ne: null,
        $ne: "",
        $gte: oneHourAgo,
        $lte: now,
      },
    }).select("-content -htmlContent");
    let updateCount = 0;
    let updatedIds = [];
    for (let editor of listEditor) {
      editor.hidden = false;
      await editor.save();
      updateCount++;
      updatedIds.push(editor._id);
    }
    if (updateCount === 0) {
      res.status(200).send({
        message: "No scheduled article need to update status",
      });
    } else {
      await scanAndDelete();
      res.status(200).send({
        message: `Successfully updated the following ids: ${updatedIds.join(
          ", "
        )}`,
      });
    }
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

editorRouter.patch(
  "/draftEditor/:id",
  uploadImage(),
  verifyUser,
  parseRequestBody,
  parseTags,
  parseCategories,
  async (req, res) => {
    const {
      title,
      tags,
      htmlContent,
      categories,
      headTitle,
      headKeyword,
      headDescription,
      manualUrl,
      altText,
      scheduledAt,
      draft,
    } = res;

    let message = "";
    if (scheduledAt) {
      message +=
        "Scheduled time has been set and cannot be for draft articles.\n";
    }
    if (draft !== true) {
      message += "Non-draft articles.\n";
    }
    if (message) {
      res.status(400).send({ message });
    } else {
      // As the "getEditor" function cannot accept query parameters but needs to be shared with GET, so need to perform a separate query to retrieve draft articles.
      const id = req.params.id;
      let editor = await draftEditor
        .findOne({ _id: id })
        .populate({ path: "categories", select: "name" })
        .populate({ path: "tags", select: "name" });
      if (editor == undefined) {
        return res.status(404).json({ message: "can't find editor!" });
      }
      res.editor = editor;

      const contentImagePath =
        req.files.contentImagePath && req.files.contentImagePath[0];
      const homeImagePath =
        req.files.homeImagePath && req.files.homeImagePath[0];

      const contentFilename = contentImagePath
        ? await processImage(contentImagePath, contentImagePath.originalname)
        : undefined;

      const homeFilename = homeImagePath
        ? await processImage(homeImagePath, homeImagePath.originalname)
        : undefined;
      if (contentFilename !== undefined) {
        if (homeImagePath) {
          res.editor.homeImagePath = homeFilename;
          if (contentFilename === "") {
            res.editor.contentImagePath = contentFilename;
          } else {
            const regex = /src="(https:\/\/www\.youtube\.com\/embed\/[^"]+)"/;
            const match = contentFilename.match(regex);

            if (match && match[1]) {
              const youtubeUrl = match[1];
              console.log(youtubeUrl);
              res.editor.contentImagePath = youtubeUrl;
            }
          }
        } else {
          res.editor.homeImagePath = `${LOCAL_DOMAIN}home/saved_image/homepage/${contentFilename}`;
          res.editor.contentImagePath = `${LOCAL_DOMAIN}home/saved_image/content/${contentFilename}`;
        }
      }
      if (manualUrl !== undefined) {
        res.editor.manualUrl = manualUrl;
      }
      if (tags !== undefined) res.editor.tags = [...tags];
      if (categories !== undefined) res.editor.categories = categories;
      if (title !== undefined) res.editor.title = title;
      if (htmlContent !== undefined) res.editor.htmlContent = htmlContent;
      if (headTitle !== undefined) res.editor.headTitle = headTitle;
      if (headKeyword !== undefined) res.editor.headKeyword = headKeyword;
      if (headDescription !== undefined)
        res.editor.headDescription = headDescription;
      if (altText !== undefined) res.editor.altText = altText;
      if (draft !== undefined) res.editor.draft = draft;
      try {
        await res.editor.save();
        await scanAndDelete();
        res.status(200).send({ message: "Draft Editor update successfully" });
      } catch (err) {
        res.status(400).send({ message: err.message });
      }
    }
  }
);

editorRouter.patch(
  "/editor/:id",
  verifyUser,
  uploadImage(),
  parseRequestBody,
  parseTags,
  parseCategories,
  getEditor,
  async (req, res) => {
    const {
      title,
      tags,
      content,
      htmlContent,
      categories,
      headTitle,
      headKeyword,
      headDescription,
      manualUrl,
      altText,
      hidden,
      scheduledAt,
      draft,
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
        res.editor.homeImagePath = homeFilename;
        if (contentFilename === "") {
          res.editor.contentImagePath = contentFilename;
        } else {
          const regex = /src="(https:\/\/www\.youtube\.com\/embed\/[^"]+)"/;
          const match = contentFilename.match(regex);

          if (match && match[1]) {
            const youtubeUrl = match[1];
            res.editor.contentImagePath = youtubeUrl;
          }
        }
      } else {
        res.editor.homeImagePath = `${LOCAL_DOMAIN}home/saved_image/homepage/${contentFilename}`;
        res.editor.contentImagePath = `${LOCAL_DOMAIN}home/saved_image/content/${contentFilename}`;
      }
    }

    if (manualUrl !== undefined) {
      res.editor.manualUrl = manualUrl;
      await Sitemap.updateOne(
        { originalID: res.editor._id, type: "editor" },
        { $set: { url: `${SUB_DOMAIN}p_${manualUrl}.html` } }
      );
    }

    if (tags !== undefined) res.editor.tags = [...tags];
    if (categories !== undefined) res.editor.categories = categories;
    if (title !== undefined) res.editor.title = title;
    if (htmlContent !== undefined) res.editor.htmlContent = htmlContent;
    if (headTitle !== undefined) res.editor.headTitle = headTitle;
    if (headKeyword !== undefined) res.editor.headKeyword = headKeyword;
    if (headDescription !== undefined)
      res.editor.headDescription = headDescription;
    if (altText !== undefined) res.editor.altText = altText;
    if (hidden !== undefined) res.editor.hidden = hidden;
    if (scheduledAt !== undefined) res.editor.scheduledAt = scheduledAt;
    if (draft !== undefined) res.editor.draft = draft;

    try {
      await logChanges(
        req.method,
        req.path,
        res.editor,
        Editor,
        "editor",
        req.session.user,
        true
      );

      await res.editor.save();
      await scanAndDelete();
      res.status(201).send({ message: "Editor update successfully" });
    } catch (err) {
      res.status(400).send({ message: err.message });
    }
  }
);

editorRouter.post(
  "/editor/getNewImagePath",
  verifyUser,
  uploadImage(),
  async (req, res) => {
    try {
      let imageBlob = req.files.imageBlob && req.files.imageBlob[0];

      if (imageBlob === undefined || imageBlob === null) {
        return res.status(400).json({ error: "Empty image value" });
      } else {
        const imageFilename = imageBlob
          ? await processImage(imageBlob, imageBlob.originalname)
          : null;
        if (imageFilename.startsWith("http")) {
          const regex = /src="(https:\/\/www\.youtube\.com\/embed\/[^"]+)"/;
          const match = imageFilename.match(regex);

          if (match && match[1]) {
            const youtubeUrl = match[1];
            imageBlob = youtubeUrl;
          }
        } else {
          imageBlob = `${LOCAL_DOMAIN}home/saved_image/content/${imageFilename}`;
        }
      }

      res.status(201).json({ imageUrl: imageBlob });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

editorRouter.post(
  "/editor",
  verifyUser,
  uploadImage(),
  parseRequestBody,
  parseTags,
  parseCategories,
  async (req, res) => {
    const {
      title,
      htmlContent,
      tags,
      categories,
      headTitle,
      headKeyword,
      headDescription,
      manualUrl,
      altText,
      topSorting,
      hidden,
      popularSorting,
      recommendSorting,
      scheduledAt,
      draft,
    } = res;

    let serialNumber = req.body.serialNumber;
    if (!serialNumber) {
      serialNumber = (await getMaxSerialNumber()) + 1;
    } else {
      try {
        //Delete draft articles to avoid data duplication.
        let deleteDraftEditor = await draftEditor.deleteOne({
          serialNumber: serialNumber,
        });
        if (!deleteDraftEditor) {
          return res
            .status(404)
            .json({ message: "No matching draftEditor found" });
        }
      } catch (err) {
        res.status(500).send({ message: err.message });
      }
    }

    let contentImagePath =
      req.files.contentImagePath && req.files.contentImagePath[0];
    let homeImagePath = req.files.homeImagePath && req.files.homeImagePath[0];
    let message = "";
    if (title === null) {
      message += "title is required\n";
    }
    if (serialNumber === null) {
      message += "serialNumber is required\n";
    }
    if (htmlContent === null) {
      message += "content is required\n";
    }
    if (draft === true) {
      message +=
        "A draft article cannot be set to true as it contradicts the definition of a draft, which is an unpublished or unfinished piece of content. \n";
    }
    if (message) {
      res.status(400).send({ message });
    } else {
      try {
        const editorData = {
          serialNumber: serialNumber,
          title,
          htmlContent,
          tags,
          categories,
          headTitle,
          headKeyword,
          headDescription,
          manualUrl,
          altText,
          topSorting,
          hidden,
          popularSorting,
          recommendSorting,
          scheduledAt,
          draft,
        };

        if (contentImagePath === undefined && homeImagePath === undefined) {
          editorData.contentImagePath = null;
          editorData.homeImagePath = null;
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
            editorData.homeImagePath = homeFilename;
            const regex = /src="(https:\/\/www\.youtube\.com\/embed\/[^"]+)"/;
            const match = contentFilename.match(regex);

            if (match && match[1]) {
              const youtubeUrl = match[1];
              editorData.contentImagePath = youtubeUrl;
            } else {
              editorData.contentImagePath = contentFilename;
            }
          } else {
            editorData.homeImagePath = `${LOCAL_DOMAIN}home/saved_image/homepage/${contentFilename}`;
            editorData.contentImagePath = `${LOCAL_DOMAIN}home/saved_image/content/${contentFilename}`;
          }
        }
        const newEditor = new Editor(editorData);
        await newEditor.save();

        //save sitemap
        let newEditorSitemap;
        const newEditorOriginalUrl = `${SUB_DOMAIN}p_${newEditor._id}.html`;
        if (newEditor) {
          let sitemapUrl;
          if (newEditor.manualUrl) {
            sitemapUrl = `${SUB_DOMAIN}p_${newEditor.manualUrl}.html`;
          } else {
            sitemapUrl = newEditorOriginalUrl;
          }

          newEditorSitemap = new Sitemap({
            url: sitemapUrl,
            originalID: newEditor._id,
            type: "editor",
          });
          await newEditorSitemap.save();
        }
        await Editor.updateOne(
          { _id: newEditor.id },
          { $set: { originalUrl: newEditorOriginalUrl } }
        );
        const updateEditor = await Editor.findOne({ _id: newEditor.id })
          .populate({ path: "categories", select: "name" })
          .populate({ path: "tags", select: "name" });

        await logChanges(
          req.method,
          req.path,
          newEditor,
          Editor,
          "editor",
          req.session.user
        );
        await scanAndDelete();
        res.status(201).json({
          ...updateEditor._doc, // Spread operator to include all properties of newEditor
          sitemapUrl: newEditorSitemap.url,
        });
      } catch (err) {
        res.status(400).json({ message: err.message });
      }
    }
  }
);

editorRouter.post(
  "/tempEditor",
  verifyUser,
  uploadImage(),
  parseRequestBody,
  async (req, res) => {
    const {
      title,
      htmlContent,
      headTitle,
      headKeyword,
      headDescription,
      manualUrl,
      altText,
      hidden,
    } = res;

    const tagsArray = req.body.tags ? JSON.parse(req.body.tags) : undefined;
    const tags = Array.isArray(tagsArray)
      ? tagsArray.map((tag) => ({ name: tag.name }))
      : undefined;
    const categoriesArray = req.body.categories
      ? JSON.parse(req.body.categories)
      : undefined;
    const categories = Array.isArray(categoriesArray)
      ? categoriesArray.map((category) => ({ name: category.name }))
      : undefined;

    const contentImagePath =
      req.files.contentImagePath && req.files.contentImagePath[0];
    const homeImagePath = req.files.homeImagePath && req.files.homeImagePath[0];
    try {
      const editorData = {
        title,
        htmlContent,
        tags,
        categories,
        headTitle,
        headKeyword,
        headDescription,
        manualUrl,
        altText,
        hidden,
      };

      if (contentImagePath === undefined && homeImagePath === undefined) {
        editorData.contentImagePath = null;
        editorData.homeImagePath = null;
      } else {
        const contentFilename = contentImagePath
          ? await processImage(contentImagePath, contentImagePath.originalname)
          : null;

        const homeFilename = homeImagePath
          ? await processImage(homeImagePath, homeImagePath.originalname)
          : null;

        if (homeImagePath && homeFilename.startsWith("http")) {
          editorData.homeImagePath = homeFilename;
          const regex = /src="(https:\/\/www\.youtube\.com\/embed\/[^"]+)"/;
          const match = contentFilename.match(regex);

          if (match && match[1]) {
            const youtubeUrl = match[1];
            editorData.contentImagePath = youtubeUrl;
          }
        } else {
          editorData.contentImagePath = `${LOCAL_DOMAIN}home/saved_image/content/${contentFilename}`;
        }
      }

      const newTempEditor = new tempEditor(editorData);
      await newTempEditor.save();

      await newTempEditor.updateOne(
        { _id: newTempEditor._id },
        {
          $set: {
            originalUrl: `${SUB_DOMAIN}preview_${newTempEditor._id}`,
          },
        }
      );

      res.status(201).send({
        data: {
          id: newTempEditor._id,
          originalUrl: newTempEditor.originalUrl,
        },
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

editorRouter.post(
  "/draftEditor",
  uploadImage(),
  parseRequestBody,
  verifyUser,
  parseTags,
  parseCategories,
  async (req, res) => {
    let {
      title,
      htmlContent,
      tags,
      categories,
      headTitle,
      headKeyword,
      headDescription,
      manualUrl,
      altText,
      scheduledAt,
      draft,
    } = res;
    const serialNumber = await getMaxSerialNumber();
    let contentImagePath =
      req.files.contentImagePath && req.files.contentImagePath[0];
    let homeImagePath = req.files.homeImagePath && req.files.homeImagePath[0];
    if (title === null || title === "") {
      title = `[未命名標題草稿${serialNumber + 1}]`;
    }
    let message = "";
    if (scheduledAt) {
      message +=
        "Scheduled time has been set and cannot be for draft articles.\n";
    }
    if (message) {
      res.status(400).send({ message });
    } else {
      try {
        const editorData = {
          serialNumber: serialNumber + 1,
          title,
          htmlContent,
          tags,
          categories,
          headTitle,
          headKeyword,
          headDescription,
          manualUrl,
          altText,
          scheduledAt,
          draft,
        };

        if (contentImagePath === undefined && homeImagePath === undefined) {
          editorData.contentImagePath = null;
          editorData.homeImagePath = null;
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
            editorData.homeImagePath = homeFilename;
            const regex = /src="(https:\/\/www\.youtube\.com\/embed\/[^"]+)"/;
            const match = contentFilename.match(regex);

            if (match && match[1]) {
              const youtubeUrl = match[1];
              editorData.contentImagePath = youtubeUrl;
            }
          } else {
            editorData.homeImagePath = `${LOCAL_DOMAIN}home/saved_image/homepage/${contentFilename}`;
            editorData.contentImagePath = `${LOCAL_DOMAIN}home/saved_image/content/${contentFilename}`;
          }
        }
        const newDraft = new draftEditor(editorData);
        await newDraft.save();
        await scanAndDelete();
        res.status(201).json({ newDraft });
      } catch (err) {
        res.status(400).json({ message: err.message });
      }
    }
  }
);

editorRouter.delete(
  "/editor/bunchDeleteByIds",
  verifyUser,
  async (req, res) => {
    try {
      const ids = req.body.ids;
      // console.log(req.body.ids);
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "Invalid data." });
      }

      const existingEditors = await Editor.find({ _id: { $in: ids } });

      if (existingEditors.length !== ids.length) {
        return res
          .status(400)
          .json({ message: "Some of the provided Editor IDs do not exist." });
      }

      await logChanges(
        req.method,
        req.path,
        existingEditors,
        Editor,
        "editor",
        req.session.user,
        true
      );

      const deleteSitemap = await Sitemap.deleteMany({
        originalID: { $in: ids },
        type: "editor",
      });
      const deleteEditor = await Editor.deleteMany({ _id: { $in: ids } });
      if (deleteEditor.deletedCount === 0) {
        return res.status(404).json({ message: "No matching editor found" });
      }
      if (deleteEditor.deletedCount !== deleteSitemap.deletedCount) {
        return res.status(404).json({ message: "No matching sitemap found" });
      }
      await scanAndDelete();
      res.status(200).json({ message: "Delete editor successful!" });
    } catch (e) {
      res.status(500).send({ message: e.message });
    }
  }
);

editorRouter.delete("/tempEditor", async (req, res) => {
  try {
    const deleteList = await tempEditor
      .find()
      .select("-_id contentImagePath homeImagePath");

    for (let doc of deleteList) {
      if (!doc.homeImagePath && doc.contentImagePath) {
        // Delete contentImagePath
        let contentImagePath = url.parse(doc.contentImagePath).path;

        fs.unlink(contentImagePath, (err) => {
          if (err) {
            console.log(
              `Error remove file ${contentImagePath}: ${err.message}`
            );
          } else {
            console.log(`File ${doc.contentImagePath} was deleted`);
          }
        });
      }
    }
    await tempEditor.deleteMany({});
    res.status(200).send("Files were deleted successfully");
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

editorRouter.delete("/draftEditor", verifyUser, async (req, res) => {
  const deleteNumber = req.body.id;
  try {
    let deleteEditor = await draftEditor.deleteOne({
      _id: deleteNumber,
    });
    if (deleteEditor.deletedCount === 0) {
      return res.status(404).json({ message: "No matching draftEditor found" });
    }
    await scanAndDelete();
    res.status(201).json({ message: "Delete draftEditor successful!" });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

editorRouter.delete("/editor/cleanupIps", async (req, res) => {
  const handleErrors = (res, error) => {
    console.error(error);
    res.status(500).json({ message: error.message });
  };
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oldLogs = await Ips.find({ createdAt: { $lt: oneHourAgo } }).select(
      "-_id sourceIp relatedId createdAt"
    );
    const filePath = path.join(DBLOG_FILE_PATH, "ipLogs.json");
    const outputFilePath = path.join(DBLOG_FILE_PATH, "no_duplicate_IP.json");

    if (oldLogs.length === 0) {
      res.status(200).json({ message: "No IP need to delete." });
    } else {
      const readAndValidateJSONFile = async (filePath) => {
        return new Promise(async (resolve, reject) => {
          let rawData = "";
          const readStream = fs.createReadStream(filePath, {
            encoding: "utf8",
          });
          readStream.on("data", (chunk) => (rawData += chunk));
          readStream.on("end", () => {
            try {
              const jsonData = JSON.parse(rawData);
              resolve(jsonData);
            } catch (err) {
              const splitContent = rawData.split("][");
              const reformattedContent = "[" + splitContent.join("],[") + "]";
              resolve(JSON.parse(reformattedContent));
            }
          });
          readStream.on("error", reject);
        });
      };

      const writeJSONFile = async (filePath, data) => {
        const writeStream = fs.createWriteStream(filePath, {
          encoding: "utf8",
        });
        const readableStream = Readable.from([JSON.stringify(data, null, 2)], {
          encoding: "utf8",
        });

        try {
          await pipelineAsync(readableStream, writeStream);
        } catch (err) {
          console.error("Pipeline failed:", err);
        }
      };

      let existingData = [];
      if (fs.existsSync(filePath)) {
        existingData = await readAndValidateJSONFile(filePath);
      }
      const combinedData = existingData.concat(oldLogs);

      await writeJSONFile(filePath, combinedData);

      // Load existing no_duplicate_IP.json data if exists
      let uniqueData = [];
      if (fs.existsSync(outputFilePath)) {
        uniqueData = await readAndValidateJSONFile(outputFilePath);
      }

      const uniqueSourceIps = new Set(uniqueData.map((log) => log.sourceIp));
      // Create a set with unique sourceIps from existingData
      const newUniqueSourceIps = new Set(
        existingData.map((log) => log.sourceIp)
      );

      // Create an array to hold the truly unique logs to be appended to no_duplicate_IP.json
      const trulyUniqueOldLogs = Array.from(newUniqueSourceIps)
        .filter((sourceIp) => !uniqueSourceIps.has(sourceIp))
        .map((sourceIp) => {
          return { sourceIp }; // Replace this with the actual log object you want to store
        });
      // Write uniqueOldLogs to no_duplicate_IP.json
      const combinedUniqueData = uniqueData.concat(trulyUniqueOldLogs);
      await writeJSONFile(outputFilePath, combinedUniqueData);

      await Ips.deleteMany({ createdAt: { $lt: oneHourAgo } });

      res.status(200).json({
        message: `Deleted ${oldLogs.length} IP(s) that were created more than one hour ago.`,
      });
    }
  } catch (error) {
    handleErrors(res, error);
  }
});

module.exports = editorRouter;

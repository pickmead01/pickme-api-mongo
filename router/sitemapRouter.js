const express = require("express");
const sitemapRouter = new express.Router();
const { SitemapStream, streamToPromise } = require("sitemap");
const { createGzip } = require("zlib");
const { Readable } = require("stream");
const Sitemap = require("../model/sitemap");
const Editor = require("../model/editor");
const Categories = require("../model/categories");
const Tags = require("../model/tags");
require("dotenv").config();

let sitemap;
const domain = process.env.DOMAIN;

sitemapRouter.post("/checkUrl", async function (req, res) {

  const url = req.body.url;

  try {
    const findData = await Sitemap.findOne({ url: url }).select(
      "url originalID type -_id"
    );
    let targetData;
    switch (findData.type) {
      case "editor":
        targetData = await Editor.findOne({ _id: findData.originalID })
          .populate({ path: "tags", select: "name" })
          .populate({ path: "categories", select: "name" });
        const tagIds = targetData.tags.map((tag) => tag._id);

        const [categorySitemap, tagSitemaps] = await Promise.all([
          Sitemap.findOne({
            originalID: targetData.categories._id,
            type: "category",
          }),
          Sitemap.find({ originalID: { $in: tagIds }, type: "tag" }),
        ]);

        const tagSitemapMap = new Map(
          tagSitemaps.map((sitemap) => [
            sitemap.originalID.toString(),
            sitemap.url,
          ])
        );

        targetData = targetData.toObject();

        if (categorySitemap) {
          targetData.categories = {
            ...targetData.categories,
            sitemapUrl: categorySitemap.url,
          };
        }

        targetData.tags = targetData.tags.map((tag) => ({
          ...tag,
          sitemapUrl: tagSitemapMap.get(tag._id.toString()),
        }));

        const editorSitemap = await Sitemap.findOne({
          originalID: targetData._id,
          type: "editor",
        });

        if (editorSitemap) {
          targetData.sitemapUrl = editorSitemap.url;
        }

        break;
      case "category":
        targetData = await Categories.findOne({ _id: findData.originalID });
        break;
      case "tag":
        targetData = await Tags.findOne({ _id: findData.originalID });
        break;
    }
    const result = { Type: findData.type, data: targetData };

    res.status(200).send(result);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

sitemapRouter.get("/sitemap/getAllUrl", async function (req, res) {
  try {
    const unCategorizedUrl = await Categories.findOne({
      keyName: "Uncategorized",
    });
    const urlList = await Sitemap.find({
      originalID: { $ne: unCategorizedUrl._id },
    }).select("-_id url");

    res.status(200).json(urlList);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

sitemapRouter.get("/sitemap.xml", async function (req, res) {
  res.header("Content-Type", "application/xml");
  res.header("Content-Encoding", "gzip");
  // if we have a cached entry send it
  // if (sitemap) {
  //   res.send(sitemap);
  //   return;
  // }

  try {
    const smStream = new SitemapStream({
      hostname: domain,
    });
    const pipeline = smStream.pipe(createGzip());
    const urlData = await Sitemap.find({}).select("url changefreq priority");
    // await Sitemap.find({});
    smStream.write({ url: "/", changefreq: "daily", priority: 0.9 });
    for (const url of urlData) {
      smStream.write({
        url: url.url,
        changefreq: url.changefreq,
        priority: url.priority,
      });
    }

    // cache the response
    streamToPromise(pipeline).then((sm) => (sitemap = sm));
    // make sure to attach a write stream such as streamToPromise before ending
    smStream.end();
    // stream write the response
    pipeline.pipe(res).on("error", (e) => {
      throw e;
    });
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

module.exports = sitemapRouter;

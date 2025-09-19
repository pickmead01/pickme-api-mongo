require("dotenv").config();
const redis = require("redis");
const REDIS_SERVER = process.env.REDIS_SERVER;

async function connectRedis() {
  const client = redis.createClient({
    socket: {
      host: REDIS_SERVER,
      port: 6379,
    },
  });

  client.on("error", (err) => console.log("Redis Client Error", err));

  try {
    await client.connect();
    console.log("Connected to Redis");
  } catch (err) {
    console.error("Redis connection error", err);
  }

  return client;
}

const redisClient = connectRedis();

const setCache = async (key, value, expired) => {
  const client = await redisClient;
  await client.set(key, JSON.stringify(value), { EX: expired, NX: true });
};

const getCache = async (key) => {
  const client = await redisClient;
  const result = await client.get(key);
  return result ? JSON.parse(result) : null;
};

const hSetCache = async (key, value) => {
  const client = await redisClient;
  await client.HSET(key, JSON.stringify(value));
};

const scanAndDelete = async () => {
  let cursor = "0";
  try {
    const client = await redisClient;
    const scanReply = await client.sendCommand([
      "SCAN",
      cursor,
      "MATCH",
      "pickme:editorList:*",
      "COUNT",
      "100",
    ]);
    cursor = scanReply[0];
    const keys = scanReply[1];

    if (keys.length > 0) {
      const delReply = await client.sendCommand(["DEL", ...keys]);
      console.log(`Deleted ${delReply} keys.`);
    }

    if (cursor !== "0") {
      scanAndDelete();
    }
  } catch (err) {
    console.log(err);
  }
};

module.exports = {
  setCache,
  getCache,
  scanAndDelete,
};

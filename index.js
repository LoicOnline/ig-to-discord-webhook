import express from "express";
import axios from "axios";

const app = express();
app.use(express.json({ limit: "1mb" }));

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const ROLE_MENTION = process.env.ROLE_MENTION || "";
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const STATE_KEY = process.env.STATE_KEY || "ig:last3:eva_savignyletemple";

if (!DISCORD_WEBHOOK_URL || !APIFY_TOKEN || !UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error("Missing env vars. Need DISCORD_WEBHOOK_URL, APIFY_TOKEN, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN");
  process.exit(1);
}

function roleIdsFromMention(mention) {
  return mention.match(/\d+/g) || [];
}

async function redisGet(key) {
  const res = await axios.get(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    timeout: 15000
  });
  return res.data?.result ?? null;
}

async function redisSet(key, value) {
  await axios.post(
    `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    null,
    { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }, timeout: 15000 }
  );
}

async function postDiscord(link) {
  const content = `${ROLE_MENTION}

**EVA SAVIGNY LE TEMPLE** vient de faire un **NOUVEAU POST** sur **INSTAGRAM** !!
Va mettre un **LIKE** et **PARTAGE EN STORY** → ${link}`;

  await axios.post(
    DISCORD_WEBHOOK_URL,
    {
      content,
      allowed_mentions: { parse: [], roles: roleIdsFromMention(ROLE_MENTION) }
    },
    { timeout: 15000 }
  );
}

// Robustly extract runId from Apify webhook payload
function extractRunId(payload) {
  return (
    payload?.resource?.id ||
    payload?.data?.actorRunId ||
    payload?.eventData?.actorRunId ||
    payload?.eventData?.resourceId ||
    payload?.resourceId ||
    null
  );
}

async function getRun(runId) {
  // Apify "Get run" endpoint
  const url = `https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(APIFY_TOKEN)}`;
  const res = await axios.get(url, { timeout: 20000 });
  return res.data?.data;
}

async function getLatestDatasetItems(datasetId, limit = 3) {
  // Apify "Get dataset items" endpoint, newest first
  const url =
    `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items` +
    `?clean=true&desc=1&limit=${limit}&token=${encodeURIComponent(APIFY_TOKEN)}`;

  const res = await axios.get(url, { timeout: 30000 });
  // When format=json (default), Apify returns array of items for /items
  return Array.isArray(res.data) ? res.data : [];
}

function extractPostIdAndLink(item) {
  // Different actors output different fields; try common ones
  const id =
    item?.id ||
    item?.shortCode ||
    item?.code ||
    item?.postId ||
    item?.url ||
    item?.link ||
    null;

  const link =
    item?.url ||
    item?.link ||
    item?.postUrl ||
    (item?.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : null) ||
    "(lien indisponible)";

  return { id, link };
}

app.post("/apify-webhook", async (req, res) => {
  try {
    const payload = req.body;
    const runId = extractRunId(payload);

    if (!runId) {
      console.error("Webhook received but runId not found in payload keys.");
      return res.status(400).send("Missing runId");
    }

    const run = await getRun(runId);
    const datasetId = run?.defaultDatasetId;

    if (!datasetId) {
      console.error("Run has no defaultDatasetId", { runId });
      return res.status(400).send("Missing defaultDatasetId");
    }

    const items = await getLatestDatasetItems(datasetId, 3);

    // Load previously seen IDs set
    const prevRaw = await redisGet(STATE_KEY);
    const prevIds = new Set(prevRaw ? JSON.parse(prevRaw) : []);

    // Build new IDs from latest 3 items
    const latest = items
      .map(extractPostIdAndLink)
      .filter(x => x.id);

    // Post any item not previously seen (from oldest->newest to keep order)
    const toPost = latest.filter(x => !prevIds.has(x.id)).reverse();

    for (const p of toPost) {
      await postDiscord(p.link);
      console.log("Posted to Discord:", p.link);
    }

    // Save the latest 3 IDs (current state) to prevent duplicates
    const latestIds = latest.slice(0, 3).map(x => x.id);
    await redisSet(STATE_KEY, JSON.stringify(latestIds));

    res.status(200).send("OK");
  } catch (err) {
    const status = err?.response?.status;
    const url = err?.config?.url;
    console.error("Handler error:", {
      status,
      url,
      message: err?.message,
      data: err?.response?.data
    });
    res.status(500).send("Error");
  }
});

app.get("/", (_, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));

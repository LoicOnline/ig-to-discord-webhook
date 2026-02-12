// index.js — Instagram RSS (RSS.app) -> Discord Webhook
// - Mentions a specific role
// - No duplicates across restarts (Upstash Redis)
// - Checks every CHECK_MINUTES
// - Fetches RSS via Axios (so we can see status/url and avoid rss-parser's internal fetch)
// - "Option C": on first run, posts the latest item once, then stores state

import axios from "axios";
import Parser from "rss-parser";

const parser = new Parser();

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const RSS_URL = process.env.RSS_URL;
const ROLE_MENTION = process.env.ROLE_MENTION || "";

// ✅ Use minutes (recommended: 10 to avoid RSS.app 402)
const CHECK_MINUTES = Number(process.env.CHECK_MINUTES || 10);

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!WEBHOOK || !RSS_URL) {
  console.error("Missing env vars: DISCORD_WEBHOOK_URL and/or RSS_URL");
  process.exit(1);
}
if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error(
    "Missing env vars: UPSTASH_REDIS_REST_URL and/or UPSTASH_REDIS_REST_TOKEN"
  );
  process.exit(1);
}

const STATE_KEY =
  process.env.STATE_KEY || "ig:lastGuid:eva_savignyletemple";

function extractGuid(item) {
  return item?.guid || item?.id || item?.link || item?.title || null;
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
    {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      timeout: 15000
    }
  );
}

async function postToDiscord(link) {
  const content = `${ROLE_MENTION}

**EVA SAVIGNY LE TEMPLE** vient de faire un **NOUVEAU POST** sur **INSTAGRAM** !!
Va mettre un **LIKE** et **PARTAGE EN STORY** → ${link}`;

  // Allow only the configured role mention (prevents abuse)
  const roleIds = ROLE_MENTION.match(/\d+/g) || [];

  await axios.post(
    WEBHOOK,
    {
      content,
      allowed_mentions: { parse: [], roles: roleIds }
    },
    { timeout: 15000 }
  );
}

async function fetchRssXml(url) {
  // RSS.app can be picky; this UA sometimes helps.
  // If RSS.app returns 402, you'll see it in the catch with status/url.
  const resp = await axios.get(url, {
    timeout: 20000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ig-to-discord-webhook/1.0; +https://railway.app)",
      "Accept": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7"
    },
    // some services respond differently based on redirects; axios follows by default
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 300 // throw on non-2xx so we can log it
  });

  return resp.data;
}

async function tick() {
  try {
    console.log("Check executed at", new Date().toISOString());

    // 1) Fetch RSS as XML (so we can capture HTTP status/errors)
    const xml = await fetchRssXml(RSS_URL);

    // 2) Parse XML
    const feed = await parser.parseString(xml);
    const items = feed.items ?? [];

    if (!items.length) {
      console.log("No items in RSS.");
      return;
    }

    // RSS.app typically returns newest first
    const latest = items[0];
    const guid = extractGuid(latest);
    const link = latest.link || "(lien indisponible)";

    if (!guid) {
      console.log("Latest item has no usable guid/id/link/title.", {
        title: latest?.title
      });
      return;
    }

    const lastGuid = await redisGet(STATE_KEY);

    // ✅ Option C: On first run, post the latest once, then store state
    if (!lastGuid) {
      await postToDiscord(link);
      await redisSet(STATE_KEY, guid);
      console.log("First run: posted latest and initialized state.", { guid });
      return;
    }

    if (guid === lastGuid) {
      console.log("No new post.", { lastGuid });
      return;
    }

    await postToDiscord(link);
    await redisSet(STATE_KEY, guid);
    console.log("Posted new IG item.", { link, guid });
  } catch (err) {
    const status = err?.response?.status;
    const url = err?.config?.url;
    const data = err?.response?.data;

    console.error("Tick error:", {
      status,
      url,
      data: typeof data === "string" ? data.slice(0, 300) : data,
      message: err?.message
    });
  }
}

console.log(
  `Started. Checking every ${CHECK_MINUTES} minute(s). STATE_KEY=${STATE_KEY}`
);

tick();
setInterval(tick, CHECK_MINUTES * 60 * 1000);

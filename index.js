// index.js — Instagram RSS (RSS.app) -> Discord Webhook (avec mention rôle)
// Anti-doublons persistants via Upstash Redis
// Option C activée: au premier run, poste UNE FOIS le dernier post puis mémorise l'état.

import axios from "axios";
import Parser from "rss-parser";

const parser = new Parser();

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const RSS_URL = process.env.RSS_URL;
const ROLE_MENTION = process.env.ROLE_MENTION || "";
const CHECK_MINUTES = Number(process.env.CHECK_MINUTES || 5);

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

// Une clé par "source" pour éviter les collisions si tu ajoutes d'autres feeds plus tard
const STATE_KEY = process.env.STATE_KEY || "ig:lastGuid:eva_savignyletemple";

function extractGuid(item) {
  return item?.guid || item?.id || item?.link || item?.title || null;
}

async function redisGet(key) {
  const res = await axios.get(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    timeout: 15000,
  });
  return res.data?.result ?? null;
}

async function redisSet(key, value) {
  await axios.post(
    `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    null,
    {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      timeout: 15000,
    }
  );
}

async function postToDiscord(link) {
  const content = `${ROLE_MENTION}

**EVA SAVIGNY LE TEMPLE** vient de faire un **NOUVEAU POST** sur **INSTAGRAM** !!
Va mettre un **LIKE** et **PARTAGE EN STORY** → ${link}`;

  // Sécurise les mentions : on autorise uniquement la mention du rôle fourni
  const roleIds = ROLE_MENTION.match(/\d+/g) || [];

  await axios.post(
    WEBHOOK,
    {
      content,
      allowed_mentions: {
        parse: [],
        roles: roleIds,
      },
    },
    { timeout: 15000 }
  );
}

async function tick() {
  try {
    const feed = await parser.parseURL(RSS_URL);
    const items = feed.items ?? [];

    if (!items.length) {
      console.log("No items in RSS.");
      return;
    }

    // RSS.app : généralement le plus récent d'abord
    const latest = items[0];
    const guid = extractGuid(latest);
    const link = latest.link || "(lien indisponible)";

    if (!guid) {
      console.log(
        "Latest item has no guid/id/link/title usable as guid. Title:",
        latest?.title
      );
      return;
    }

    const lastGuid = await redisGet(STATE_KEY);

    // ✅ Option C : au premier run, on annonce UNE FOIS puis on mémorise.
    if (!lastGuid) {
      await postToDiscord(link);
      await redisSet(STATE_KEY, guid);
      console.log(
        "First run: posted latest and initialized state. lastGuid =",
        guid
      );
      return;
    }

    if (guid === lastGuid) {
      console.log("No new post. lastGuid =", lastGuid);
      return;
    }

    // Nouveau post détecté → on poste puis on met à jour l'état
    await postToDiscord(link);
    await redisSet(STATE_KEY, guid);

    console.log("Posted new IG item:", link, "guid:", guid);
} catch (err) {
  const status = err?.response?.status;
  const url = err?.config?.url;
  const data = err?.response?.data;

  console.error("Tick error:", {
    status,
    url,
    data: typeof data === "string" ? data.slice(0, 200) : data
  });
}

console.log(
  `Started. Checking every ${CHECK_MINUTES} minute(s). STATE_KEY=${STATE_KEY}`
);

tick();
setInterval(tick, CHECK_MINUTES * 60 * 1000);

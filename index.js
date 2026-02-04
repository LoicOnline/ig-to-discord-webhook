import axios from "axios";
import Parser from "rss-parser";

const parser = new Parser();

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const RSS_URL = process.env.RSS_URL;
const ROLE_MENTION = process.env.ROLE_MENTION || "";
const CHECK_HOURS = Number(process.env.CHECK_HOURS || 12);

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!WEBHOOK || !RSS_URL) {
  console.error("Missing env vars: DISCORD_WEBHOOK_URL and/or RSS_URL");
  process.exit(1);
}
if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error("Missing env vars: UPSTASH_REDIS_REST_URL and/or UPSTASH_REDIS_REST_TOKEN");
  process.exit(1);
}

const STATE_KEY = process.env.STATE_KEY || "ig:lastGuid:eva_savignyletemple";

function extractGuid(item) {
  return item?.guid || item?.id || item?.link || item?.title || null;
}

async function redisGet(key) {
  const res = await axios.get(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  return res.data?.result ?? null;
}

async function redisSet(key, value) {
  await axios.post(`${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, null, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
}

async function postToDiscord(link) {
  const content =
`${ROLE_MENTION}

**EVA SAVIGNY LE TEMPLE** vient de faire un **NOUVEAU POST** sur **INSTAGRAM** !!
Va mettre un **LIKE** et **PARTAGE EN STORY** → ${link}`;

  // IMPORTANT : on autorise uniquement la mention du rôle donné
  const roleIds = ROLE_MENTION.match(/\d+/g) || [];

  await axios.post(WEBHOOK, {
    content,
    allowed_mentions: {
      parse: [],
      roles: roleIds
    }
  });
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
    const link = latest.link;

    if (!guid) {
      console.log("Latest item has no guid/id/link/title usable as guid.");
      return;
    }

    const lastGuid = await redisGet(STATE_KEY);

    if (!lastGuid) {
      // Premier run (ou state perdu) : on initialise SANS poster pour éviter un spam.
      await redisSet(STATE_KEY, guid);
      console.log("Initialized state. lastGuid =", guid);
      return;
    }

    if (guid === lastGuid) {
      console.log("No new post. lastGuid =", lastGuid);
      return;
    }

    // Nouveau post détecté → on poste puis on met à jour l'état
    await postToDiscord(link || "(lien indisponible)");
    await redisSet(STATE_KEY, guid);

    console.log("Posted new IG item:", link, "guid:", guid);
  } catch (err) {
    console.error("Tick error:", err?.response?.data || err?.message || err);
  }
}

console.log(`Started. Checking every ${CHECK_HOURS} hour(s). STATE_KEY=${STATE_KEY}`);
tick();
setInterval(tick, CHECK_HOURS * 60 * 60 * 1000);

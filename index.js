// index.js — GitHub Actions friendly IG -> Discord
// - Runs every 30 min (via workflow)
// - Tries IG "web_profile_info" (often rate-limited on GitHub runners)
// - Fallback: fetches profile page via r.jina.ai proxy and extracts post shortcodes
// - Anti-duplicates stored in state.json committed back to repo

import axios from "axios";
import fs from "fs";

const INSTAGRAM_USERNAME = process.env.IG_USER || "eva_savignyletemple";
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const ROLE_MENTION = process.env.ROLE_MENTION || "<@&1434908536034299925>";

const STATE_FILE = "./state.json";
const CHECK_LIMIT = 3;

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveState(ids) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(ids, null, 2));
}

function roleIdsFromMention(mention) {
  return mention.match(/\d+/g) || [];
}

async function postDiscord(link) {
  if (!DISCORD_WEBHOOK) throw new Error("Missing DISCORD_WEBHOOK_URL secret");

  await axios.post(
    DISCORD_WEBHOOK,
    {
      content: `${ROLE_MENTION}

**EVA SAVIGNY LE TEMPLE** vient de faire un **NOUVEAU POST** sur **INSTAGRAM** !!
Va mettre un **LIKE** et **PARTAGE EN STORY** → ${link}`,
      allowed_mentions: { parse: [], roles: roleIdsFromMention(ROLE_MENTION) }
    },
    { timeout: 20000 }
  );
}

// --- Method A: IG web_profile_info (can be rate-limited on GitHub Actions) ---
async function getLastPostsViaWebProfileInfo() {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(
    INSTAGRAM_USERNAME
  )}`;

  const res = await axios.get(url, {
    timeout: 20000,
    validateStatus: () => true,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept": "application/json,text/plain,*/*",
      "X-IG-App-ID": "936619743392459",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": `https://www.instagram.com/${INSTAGRAM_USERNAME}/`
    }
  });

  console.log("IG API status:", res.status);

  if (res.status !== 200 || typeof res.data !== "object") {
    throw new Error(`IG API blocked. status=${res.status}`);
  }

  const edges =
    res.data?.data?.user?.edge_owner_to_timeline_media?.edges || [];

  const posts = edges
    .slice(0, CHECK_LIMIT)
    .map((edge) => {
      const shortcode = edge?.node?.shortcode;
      const id = edge?.node?.id || shortcode;
      return shortcode
        ? { id, link: `https://www.instagram.com/p/${shortcode}/` }
        : null;
    })
    .filter(Boolean);

  if (!posts.length) throw new Error("IG API returned 0 posts.");

  return posts;
}

// --- Method B: Fallback via r.jina.ai proxy; extract "shortcode":"..." from HTML/embedded JSON ---
async function getLastPostsViaJinaProxy() {
  // Use https directly (more reliable)
  const jinaUrl = `https://r.jina.ai/https://www.instagram.com/${INSTAGRAM_USERNAME}/`;

  const res = await axios.get(jinaUrl, {
    timeout: 30000,
    validateStatus: () => true,
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  console.log("Jina proxy status:", res.status);

  if (res.status < 200 || res.status >= 300 || typeof res.data !== "string") {
    throw new Error(`Jina fetch failed. status=${res.status}`);
  }

  const text = res.data;

  // 1) Primary: embedded JSON has "shortcode":"Cxxxx"
  const reShortcode = /"shortcode":"([A-Za-z0-9_-]+)"/g;
  const seen = new Set();
  const posts = [];
  let match;

  while ((match = reShortcode.exec(text)) !== null) {
    const sc = match[1];
    if (!seen.has(sc)) {
      seen.add(sc);
      posts.push({ id: sc, link: `https://www.instagram.com/p/${sc}/` });
      if (posts.length >= CHECK_LIMIT) break;
    }
  }

  // 2) Fallback: sometimes real links /p/<shortcode>/ exist
  if (!posts.length) {
    const reP = /\/p\/([A-Za-z0-9_-]+)\//g;
    while ((match = reP.exec(text)) !== null) {
      const sc = match[1];
      if (!seen.has(sc)) {
        seen.add(sc);
        posts.push({ id: sc, link: `https://www.instagram.com/p/${sc}/` });
        if (posts.length >= CHECK_LIMIT) break;
      }
    }
  }

  if (!posts.length) {
    console.log("Jina HTML snippet:", text.slice(0, 800));
    throw new Error("Could not extract any post shortcodes from HTML.");
  }

  return posts;
}

async function getLastPosts() {
  try {
    const posts = await getLastPostsViaWebProfileInfo();
    console.log("Fetched via IG API:", posts.map((p) => p.link));
    return posts;
  } catch (e) {
    console.log("IG API failed, fallback to Jina proxy. Reason:", e.message);
    const posts = await getLastPostsViaJinaProxy();
    console.log("Fetched via Jina:", posts.map((p) => p.link));
    return posts;
  }
}

async function main() {
  const lastPosts = await getLastPosts();
  const sentIds = loadState();

  const newPosts = lastPosts.filter((p) => !sentIds.includes(p.id));
  console.log("New posts to send:", newPosts.map((p) => p.link));

  for (const post of newPosts.reverse()) {
    await postDiscord(post.link);
    console.log("Posted:", post.link);
  }

  saveState(lastPosts.map((p) => p.id));
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

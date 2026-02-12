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

// ✅ New method (more robust than ?__a=1)
async function getLastPosts() {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(
    INSTAGRAM_USERNAME
  )}`;

  const res = await axios.get(url, {
    timeout: 20000,
    maxRedirects: 0,
    validateStatus: () => true,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept": "application/json,text/plain,*/*",
      "X-IG-App-ID": "936619743392459", // common web app id
      "X-Requested-With": "XMLHttpRequest",
      "Referer": `https://www.instagram.com/${INSTAGRAM_USERNAME}/`
    }
  });

  console.log("IG fetch status:", res.status);

  // If IG blocks, you'll see 302/403/429 or HTML
  if (res.status !== 200 || typeof res.data !== "object") {
    const snippet =
      typeof res.data === "string" ? res.data.slice(0, 200) : JSON.stringify(res.data).slice(0, 200);
    throw new Error(`Instagram blocked or changed response. status=${res.status} snippet=${snippet}`);
  }

  const edges =
    res.data?.data?.user?.edge_owner_to_timeline_media?.edges || [];

  const posts = edges.slice(0, CHECK_LIMIT).map((edge) => {
    const shortcode = edge?.node?.shortcode;
    const id = edge?.node?.id || shortcode;
    return {
      id,
      link: shortcode ? `https://www.instagram.com/p/${shortcode}/` : null
    };
  }).filter(p => p.id && p.link);

  console.log("Fetched links:", posts.map(p => p.link));
  return posts;
}

async function main() {
  const lastPosts = await getLastPosts();
  const sentIds = loadState();

  const newPosts = lastPosts.filter((p) => !sentIds.includes(p.id));
  console.log("New posts to send:", newPosts.map(p => p.link));

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

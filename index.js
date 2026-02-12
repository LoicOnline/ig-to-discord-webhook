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

// Scrape "best effort" without login.
// NOTE: This endpoint can change; 30-min schedule reduces risk.
async function getLastPosts() {
  const url = `https://www.instagram.com/${INSTAGRAM_USERNAME}/?__a=1&__d=dis`;
  const res = await axios.get(url, {
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  const edges =
    res.data?.graphql?.user?.edge_owner_to_timeline_media?.edges || [];

  return edges.slice(0, CHECK_LIMIT).map(edge => ({
    id: edge.node.id,
    shortcode: edge.node.shortcode,
    link: `https://www.instagram.com/p/${edge.node.shortcode}/`
  }));
}

async function postDiscord(link) {
  if (!DISCORD_WEBHOOK) throw new Error("Missing DISCORD_WEBHOOK_URL secret");

  const roleIds = ROLE_MENTION.match(/\d+/g) || [];

  await axios.post(DISCORD_WEBHOOK, {
    content: `${ROLE_MENTION}

**EVA SAVIGNY LE TEMPLE** vient de faire un **NOUVEAU POST** sur **INSTAGRAM** !!
Va mettre un **LIKE** et **PARTAGE EN STORY** → ${link}`,
    allowed_mentions: { parse: [], roles: roleIds }
  }, { timeout: 20000 });
}

async function main() {
  const lastPosts = await getLastPosts();
  const sentIds = loadState();

  const newPosts = lastPosts.filter(p => !sentIds.includes(p.id));

  for (const post of newPosts.reverse()) {
    await postDiscord(post.link);
    console.log("Posted:", post.link);
  }

  saveState(lastPosts.map(p => p.id));
}

main().catch(err => {
  console.error("Error:", err?.response?.status, err?.message);
  process.exit(1);
});

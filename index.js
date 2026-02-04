import axios from "axios";
import Parser from "rss-parser";

const parser = new Parser();

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const RSS_URL = process.env.RSS_URL;
const ROLE_MENTION = process.env.ROLE_MENTION || "";
const CHECK_MINUTES = Number(process.env.CHECK_MINUTES || 5);

if (!WEBHOOK || !RSS_URL) {
  console.error("Missing env vars: DISCORD_WEBHOOK_URL and/or RSS_URL");
  process.exit(1);
}

// On garde en mémoire le dernier item posté pour éviter les doublons.
// (Si Railway redémarre, il peut repost le dernier — option 'persist' plus bas.)
let lastGuid = null;

async function tick() {
  try {
    const feed = await parser.parseURL(RSS_URL);
    const items = feed.items ?? [];
    if (!items.length) return;

    // RSS.app met généralement le plus récent en premier
    const latest = items[0];
    const guid = latest.guid || latest.id || latest.link || latest.title;

    if (!guid) return;

    if (lastGuid === null) {
      // Premier lancement : on “initialise” sans poster (évite un spam au démarrage)
      lastGuid = guid;
      console.log("Initialized lastGuid:", guid);
      return;
    }

    if (guid === lastGuid) {
      return; // rien de nouveau
    }

    lastGuid = guid;

    const link = latest.link || "(lien indisponible)";
    const content =
`${ROLE_MENTION}

**EVA SAVIGNY LE TEMPLE** vient de faire un **NOUVEAU POST** sur **INSTAGRAM** !!
Va mettre un **LIKE** et **PARTAGE EN STORY** → ${link}`;

    await axios.post(WEBHOOK, {
      content,
      allowed_mentions: {
        parse: [],
        roles: ROLE_MENTION.match(/\d+/g) ? ROLE_MENTION.match(/\d+/g) : []
      }
    });

    console.log("Posted:", link);
  } catch (err) {
    console.error("Tick error:", err?.message || err);
  }
}

console.log("Started. Checking every", CHECK_MINUTES, "minutes.");
tick();
setInterval(tick, CHECK_MINUTES * 60 * 1000);

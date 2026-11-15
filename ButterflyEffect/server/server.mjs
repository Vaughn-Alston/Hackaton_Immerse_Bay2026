// ButterflyEffect token server.
// Keeps the Reactor API key on this machine and hands clients a short-lived,
// model-scoped token. Also serves the story file and a browser check page.
//
//   node server.mjs
//
// No dependencies. Needs Node 21+ (built-in fetch and process.loadEnvFile).

import http from "node:http";
import os from "node:os";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { direct, claudeReady } from "./brain.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const API_KEY = process.env.REACTOR_API_KEY ?? "";
const MODEL = process.env.REACTOR_MODEL || "reactor/visko-orbis-stable";
const API_URL = process.env.REACTOR_API_URL || "https://api.reactor.inc";
const PORT = Number(process.env.PORT || 8787);
// Sessions are billed per second, so every session this server authorises is capped.
const MAX_SESSION_SECONDS = Number(process.env.MAX_SESSION_SECONDS || 900);
const TOKEN_LIFETIME_SECONDS = Number(process.env.TOKEN_LIFETIME_SECONDS || 900);

const STORY_FILE = path.join(here, "..", "prompt", "story.json");
const CHARACTERS_FILE = path.join(here, "..", "prompt", "characters.json");
const INTERACTION_AUDIO_FILE = path.join(here, "..", "prompt", "interaction-audio.json");
const ANGER_MONSTER_FILE = path.join(here, "..", "prompt", "anger-monster.md");
const PAGE_FILE = path.join(here, "public", "index.html");
const RIPPLE_DIR = path.join(here, "public", "ripple");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".mp3": "audio/mpeg", ".satie": "text/plain" };

async function readBody(req, limit = 8_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(res, status, body, type = "application/json") {
  const binary = Buffer.isBuffer(body);
  res.writeHead(status, {
    "Content-Type": binary ? type : `${type}; charset=utf-8`,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(typeof body === "string" || binary ? body : JSON.stringify(body));
}

async function mintToken() {
  if (!API_KEY || API_KEY.startsWith("rk_replace")) {
    return { status: 500, body: { error: "REACTOR_API_KEY is not set in server/.env" } };
  }
  const reply = await fetch(`${API_URL}/tokens`, {
    method: "POST",
    headers: { "Reactor-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      expires_after: TOKEN_LIFETIME_SECONDS,
      authorization_details: [
        {
          type: "session",
          resources: { models: { match: [MODEL] } },
          constraints: { max_sessions: 2, max_session_duration_seconds: MAX_SESSION_SECONDS },
        },
      ],
    }),
  });
  const text = await reply.text();
  if (!reply.ok) {
    return { status: 502, body: { error: `Reactor refused the token request (${reply.status})`, detail: text.slice(0, 500) } };
  }
  const { jwt, expires_at } = JSON.parse(text);
  return { status: 200, body: { token: jwt, model: MODEL, expiresAt: expires_at } };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "POST" && url.pathname === "/session") {
      const { status, body } = await mintToken();
      console.log(`${new Date().toISOString()} /session -> ${status} for ${req.socket.remoteAddress}`);
      return send(res, status, body);
    }
    if (req.method === "GET" && url.pathname === "/story") {
      const story = await readFile(STORY_FILE, "utf8");
      JSON.parse(story); // fail loudly here rather than in the headset
      return send(res, 200, story);
    }
    if (req.method === "GET" && url.pathname === "/characters") {
      const characters = await readFile(CHARACTERS_FILE, "utf8");
      JSON.parse(characters);
      return send(res, 200, characters);
    }
    if (req.method === "GET" && url.pathname === "/interaction-audio") {
      const interactionAudio = await readFile(INTERACTION_AUDIO_FILE, "utf8");
      JSON.parse(interactionAudio);
      return send(res, 200, interactionAudio);
    }
    if (req.method === "GET" && url.pathname === "/prompt/anger-monster") {
      return send(res, 200, await readFile(ANGER_MONSTER_FILE, "utf8"), "text/markdown");
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true, model: MODEL, keyConfigured: Boolean(API_KEY) && !API_KEY.startsWith("rk_replace"),
        claude: await claudeReady(),
      });
    }

    // The Ripple (WebXR): static files plus the Global Story Director.
    if (req.method === "GET" && url.pathname === "/ripple") {
      res.writeHead(302, { Location: "/ripple/" + url.search });
      return res.end();
    }
    if (req.method === "GET" && url.pathname.startsWith("/ripple/")) {
      const file = path.join(RIPPLE_DIR, path.normalize(url.pathname.slice("/ripple/".length) || "index.html"));
      const type = TYPES[path.extname(file)];
      if (!file.startsWith(RIPPLE_DIR + path.sep) || !type || !existsSync(file)) return send(res, 404, { error: "not found" });
      return send(res, 200, await readFile(file), type);
    }
    if (req.method === "POST" && url.pathname === "/direct") {
      const beat = await direct(JSON.parse(await readBody(req)));
      return beat ? send(res, 200, beat) : send(res, 503, { error: "No director available; the client scripts this beat itself." });
    }
    send(res, 404, { error: "not found" });
  } catch (error) {
    console.error(error);
    send(res, 500, { error: String(error?.message ?? error) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => n.address);
  console.log(`ButterflyEffect server, model ${MODEL}`);
  console.log(`  this Mac:   http://localhost:${PORT}/`);
  console.log(`  The Ripple: http://localhost:${PORT}/ripple/   (Quest: run "adb reverse tcp:${PORT} tcp:${PORT}", then open this same address in the headset)`);
  for (const ip of lan) console.log(`  headset:    http://${ip}:${PORT}   <- Server Url in Unity`);
  if (!API_KEY || API_KEY.startsWith("rk_replace")) console.log("  WARNING: REACTOR_API_KEY is not set in server/.env");
});

// The Ripple: WebXR app. Living Windows, voice turns, and the story flow.
//
// URL switches:  ?mock=1  no Reactor sessions (placeholder pictures, nothing billed)
//                ?fast=1  very short holds, for testing
//                ?auto=NPP  scripted answers (N harsh, P kind, U unclear), repeating
//                ?live=3  how many side windows get their own live video (default: all 8)

import * as THREE from "three";
import { XRButton } from "three/addons/webxr/XRButton.js";
import { World, FULL, SMALL, NONE, AI_SIDE_STORY } from "./state.js";
import { CAST, SCENARIOS, captionFor, soloPrompt, encounterPrompt, outcomePrompt, localSideBeat } from "./content.js";
import { LiveStream } from "./stream.js";
import { Voice } from "./voice.js";

const params = new URLSearchParams(location.search);
const MOCK = params.has("mock");
const FAST = params.has("fast");
const AUTO = (params.get("auto") ?? "").toUpperCase();
const HOLD = FAST ? 250 : 11000;       // how long an outcome beat plays before the story moves on
const SIDE_EVERY = FAST ? 400 : 30000; // pause between AI side-story beats
const SETTLE = FAST ? 0 : 9000;         // how long a new moment plays before the main picture freezes for the player
const MAX_CHARACTERS = 14;
// Every live window is its own Reactor session, billed per second while it is open.
const LIVE_SIDES = Number(params.get("live") ?? 8);

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// ---------------------------------------------------------------- scene

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 50);
camera.position.set(0, 1.5, 0); // flat-screen view; in XR the headset pose replaces this
camera.rotation.order = "YXZ";
// On a flat screen, drag to look around at the side windows.
renderer.domElement.addEventListener("pointermove", (event) => {
  if (!event.buttons || renderer.xr.isPresenting) return;
  camera.rotation.y = THREE.MathUtils.clamp(camera.rotation.y + event.movementX * 0.004, -1.4, 1.4);
});
const VIEW_DISTANCE = 2.2;
const stage = new THREE.Group(); // everything hangs here, in front of the viewer at eye height
stage.position.set(0, 1.5, -VIEW_DISTANCE);
scene.add(stage);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

class TextPlate {
  constructor(width, height, pixelsWide = 1024) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = pixelsWide;
    this.canvas.height = Math.round((pixelsWide * height) / width);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }),
    );
  }

  /** lines: [{ text, size, color, bold }], wrapped to the plate width. */
  draw(lines) {
    const g = this.canvas.getContext("2d");
    const { width, height } = this.canvas;
    g.clearRect(0, 0, width, height);
    g.fillStyle = "rgba(12,12,14,0.86)";
    g.beginPath(); g.roundRect(0, 0, width, height, 22); g.fill();
    let y = 18;
    for (const { text, size = 36, color = "#e8e6e3", bold = false } of lines) {
      if (!text) continue;
      g.font = `${bold ? "600 " : ""}${size}px system-ui, sans-serif`;
      g.fillStyle = color;
      let line = "";
      for (const word of String(text).split(" ")) {
        if (line && g.measureText(line + word).width > width - 56) { y += size * 1.25; g.fillText(line, 28, y); line = ""; }
        line += word + " ";
      }
      y += size * 1.25; g.fillText(line, 28, y);
      y += size * 0.3;
    }
    this.texture.needsUpdate = true;
  }
}

function makeMonster() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 16), new THREE.MeshBasicMaterial({ color: 0x1a1719 })));
  // An ember rim, so the dark body reads against a dark room as well as against passthrough.
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.56, 20, 16), new THREE.MeshBasicMaterial({ color: 0x8a2a14, side: THREE.BackSide })));
  for (const x of [-0.17, 0.17]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5a2a }));
    eye.position.set(x, 0.1, 0.44);
    group.add(eye);
  }
  group.scale.setScalar(0.0001);
  return group;
}

const MONSTER_SIZE = { [FULL]: 1, [SMALL]: 0.45, [NONE]: 0 };
const panels = new Set();

/** One Living Window: a 16:9 screen, a name plate under it, and a Monster on its corner. */
class Panel {
  constructor(width) {
    this.width = width;
    const height = (width * 9) / 16;
    this.group = new THREE.Group();
    this.border = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.03, height + 0.03), new THREE.MeshBasicMaterial({ color: 0x2a2a30 }));
    this.border.position.z = -0.004;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }));
    this.plate = new TextPlate(width, width * 0.2, 768);
    this.plate.mesh.position.y = -height / 2 - width * 0.1 - 0.025;
    // Left corner: this window's own character. Right corner: the person they are facing.
    this.monsters = [-1, 1].map((sideOfScreen) => {
      const monster = makeMonster();
      monster.position.set(sideOfScreen * (width / 2 - width * 0.04), height / 2, 0.08);
      monster.userData.target = 0;
      return monster;
    });
    this.group.add(this.border, this.screen, this.plate.mesh, ...this.monsters);
    panels.add(this);
  }

  setTexture(texture) {
    this.frozen?.dispose();
    this.frozen = null;
    this.screen.material.map = texture;
    this.screen.material.color.set(0xffffff);
    this.screen.material.needsUpdate = true;
  }

  /** Shows a still picture instead of live video. */
  freeze(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.setTexture(texture);
    this.frozen = texture;
  }

  label(name, detail, live = false) {
    this.plate.draw([
      { text: name + (live ? "  · live" : ""), size: 52, bold: true },
      { text: detail, size: 38, color: "#b9b6ae" },
    ]);
  }

  setMonster(state, other = NONE) {
    this.monsters[0].userData.target = MONSTER_SIZE[state] * this.width * 0.2;
    this.monsters[1].userData.target = MONSTER_SIZE[other] * this.width * 0.2;
  }
  highlight(on) { this.border.material.color.set(on ? 0xc2452d : 0x2a2a30); }

  tick(time) {
    for (const m of this.monsters) {
      m.userData.size = THREE.MathUtils.lerp(m.userData.size ?? 0, m.userData.target, 0.06);
      m.scale.setScalar(Math.max(m.userData.size, 0.0001) * (1 + 0.04 * Math.sin(time * 0.004)));
      m.visible = m.userData.size > 0.002;
    }
  }

  dispose() { panels.delete(this); this.group.removeFromParent(); this.frozen?.dispose(); }
}

const mainPanel = new Panel(1.6);
stage.add(mainPanel.group);

const hud = new TextPlate(1.6, 0.17);
hud.mesh.position.y = 0.45 + 0.24; // clear of the Monster on the window corner
const caption = new TextPlate(1.6, 0.36);
caption.mesh.position.y = -0.45 - 0.32 - 0.24;
stage.add(hud.mesh, caption.mesh);

// Side windows sit on an arc around the viewer: [angle in degrees, height].
const SLOTS = [[-44, 0.3], [44, 0.3], [-44, -0.38], [44, -0.38], [-70, 0.3], [70, 0.3], [-70, -0.38], [70, -0.38]];
const freeSlots = SLOTS.map((_, i) => i);
const sidePanels = new Map(); // characterId -> { panel, slot, detail, stream, connected, live }

// ---------------------------------------------------------------- state

const world = new World();
const voice = new Voice();
let main, health = {};
let running = false, engagedId = null, otherId = null, castIndex = 0, autoIndex = 0;
let hudStatus = "", pendingTurn = null, talking = false;

function newCharacter(custom) {
  if (world.list().length >= MAX_CHARACTERS) return null;
  const taken = new Set(world.list().map((c) => c.name.toLowerCase()));
  if (custom?.name && custom?.appearanceDescription && !taken.has(custom.name.toLowerCase())) {
    return world.add({ characterId: "person_" + custom.name.toLowerCase().replace(/\W+/g, "_"), ...custom });
  }
  while (castIndex < CAST.length && taken.has(CAST[castIndex].name.toLowerCase())) castIndex++;
  return castIndex < CAST.length ? world.add(CAST[castIndex++]) : null;
}

/** Someone for `actor` to run into: a new face while there are any, otherwise someone already met. */
function someoneToMeet(actor, custom) {
  return newCharacter(custom) ?? pick(world.list().filter((c) => c !== actor && c.characterId !== world.mainId && c.characterId !== engagedId)) ?? null;
}

function setCaption(text, detail = "") {
  caption.draw([{ text, size: 44 }, { text: detail, size: 34, color: "#b9b6ae" }]);
  $("caption").textContent = detail ? `${text}  ${detail}` : text;
}

function drawHud() {
  hud.draw([
    { text: `Monsters in the world: ${world.monsterCount}`, size: 50, bold: true, color: world.monsterCount ? "#ff6a45" : "#8fd694" },
    { text: hudStatus, size: 36, color: "#b9b6ae" },
  ]);
  $("status").textContent = `${world.monsterCount} monster(s). ${hudStatus}`;
}
const setStatus = (text) => { hudStatus = text; drawHud(); };

const describe = (c) => c.monsterState === NONE ? "at peace" : c.monsterState === SMALL ? "monster shrinking" : "carrying a monster";

/** Brings windows, labels and Monsters in line with the world state. */
function refresh() {
  for (const c of world.list()) {
    // A side window exists only while its character carries a Monster.
    const isSide = c.storyMode === AI_SIDE_STORY && c.monsterState !== NONE;
    if (isSide && !sidePanels.has(c.characterId) && freeSlots.length) {
      const slot = freeSlots.shift();
      const panel = new Panel(0.78);
      const [degrees, y] = SLOTS[slot];
      const angle = THREE.MathUtils.degToRad(degrees);
      // The viewer stands at (0, 0, VIEW_DISTANCE) in stage space.
      panel.group.position.set(Math.sin(angle) * VIEW_DISTANCE, y, VIEW_DISTANCE - Math.cos(angle) * VIEW_DISTANCE);
      panel.group.rotation.y = -angle;
      stage.add(panel.group);
      const entry = { panel, slot, detail: "", stream: null, connected: Promise.resolve(false), live: false };
      if ([...sidePanels.values()].filter((e) => e.stream).length < LIVE_SIDES) {
        entry.stream = new LiveStream(c.name, { mock: MOCK });
        entry.connected = entry.stream.connect().then(() => true, (error) => {
          console.warn(`No live video for ${c.name}:`, error.message); // the window stays, its state still moves
          return false;
        });
      }
      sidePanels.set(c.characterId, entry);
      c.activeWindowId = "window_" + c.characterId;
    }
    if (!isSide && sidePanels.has(c.characterId)) {
      const entry = sidePanels.get(c.characterId);
      if (c.storyMode !== AI_SIDE_STORY) closeSide(c.characterId); // stepped into the main story
      else if (!entry.closing) {
        // Monster gone: let the dissolve play, then the window leaves the network.
        entry.closing = true;
        entry.panel.setMonster(NONE);
        entry.panel.label(c.name, entry.detail || "at peace", entry.live);
        setTimeout(() => { if (sidePanels.get(c.characterId) === entry) closeSide(c.characterId); refresh(); }, HOLD);
      }
    }
  }
  for (const [id, entry] of sidePanels) {
    const c = world.get(id);
    if (entry.closing && c.monsterState !== NONE) entry.closing = false; // caught a new one before the window left
    if (entry.closing) continue;
    entry.panel.setMonster(c.monsterState);
    entry.panel.label(c.name, entry.detail || describe(c), entry.live);
  }
  const lead = world.main;
  const other = otherId && otherId !== world.mainId ? world.get(otherId) : null;
  mainPanel.setMonster(lead ? lead.monsterState : NONE, other ? other.monsterState : NONE);
  if (lead) {
    const facing = other ? `  ·  ${other.name}: ${other.monsterState === NONE ? "no monster" : other.monsterState === SMALL ? "small monster" : "monster"}` : "";
    mainPanel.label(lead.name, describe(lead) + facing);
    lead.activeWindowId = "window_main";
  }
  drawHud();
}

world.on((event) => {
  if (event.type !== "WORLD_STATE_UPDATED") console.log("[ripple]", event.type, event.characterId ?? `${event.actorId}->${event.recipientId} ${event.action}`);
  else { console.log("[ripple] monsters:", event.monsterCount); refresh(); }
});

// ---------------------------------------------------------------- side stories

/** Removes a side window and ends its video session, even one that is still connecting. */
function closeSide(id) {
  const entry = sidePanels.get(id);
  if (!entry) return;
  sidePanels.delete(id);
  console.log("[ripple] side window closed:", id, "windows left:", sidePanels.size);
  entry.panel.dispose();
  freeSlots.push(entry.slot);
  entry.connected.then(() => entry.stream?.close());
}

/** Sends a new beat to `character`'s own side window. */
async function showSide(character, prompt) {
  const id = character.characterId;
  const entry = sidePanels.get(id);
  try {
    if (!entry?.stream || !(await entry.connected) || sidePanels.get(id) !== entry) return;
    await entry.stream.show(prompt, { cut: !entry.live });
    if (sidePanels.get(id) !== entry || entry.live) return;
    entry.live = true;
    entry.panel.setTexture(entry.stream.texture);
    refresh();
  } catch (error) { console.warn(`Side video for ${character.name} failed:`, error.message); }
}

async function proposeSideBeat(actor) {
  if (health.claude) {
    try {
      const reply = await fetch("/direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor, knownNames: world.list().map((c) => c.name), monsterCount: world.monsterCount }),
      });
      const beat = await reply.json();
      if (reply.ok && (beat.action === "POSITIVE" || beat.action === "NEGATIVE") && beat.place) return beat;
    } catch (error) { console.warn("Director unavailable:", error.message); }
  }
  const local = localSideBeat(actor);
  return { action: local.action, place: local.scenario.place, beat: local.beat, other: null, caption: "", source: "local" };
}

async function sideLoop() {
  let turn = 0;
  while (running) {
    await sleep(SIDE_EVERY);
    if (!running) return;
    const carriers = world.list().filter((c) => c.storyMode === AI_SIDE_STORY && c.monsterState !== NONE);
    if (!carriers.length) continue;
    const actor = carriers[turn++ % carriers.length];
    try {
      // The director only proposes. The state manager decides what actually changes.
      const beat = await proposeSideBeat(actor);
      if (!running || actor.storyMode !== AI_SIDE_STORY || actor.monsterState === NONE) continue;
      const other = someoneToMeet(actor, beat.other);
      if (!other) continue;
      const types = world.resolve(actor.characterId, other.characterId, beat.action, beat.caption).map((e) => e.type);
      const entry = sidePanels.get(actor.characterId);
      if (entry) {
        // Always say where the Monster stands, so one kind act is not mistaken for the end.
        const progress = beat.action === "NEGATIVE" ? (types.includes("MONSTER_REGROWN") ? "Monster back to full size." : "")
          : types.includes("MONSTER_REMOVED") ? "Kind twice: monster gone." : "Kind 1 of 2: monster shrinks.";
        const what = beat.caption || (beat.action === "NEGATIVE" ? `takes it out on ${other.name}` : `is kind to ${other.name}`);
        entry.detail = `${what}. ${progress}`.replace(/\.\. /, ". ").trim();
      }
      actor.currentLocation = beat.place;
      refresh();
      showSide(actor, outcomePrompt(actor, other, beat.place, beat.action, types, beat.beat));
      if (types.includes("SIDE_STORY_CREATED")) showSide(other, soloPrompt(other, "walks on alone, shaken and angry"));
    } catch (error) { console.warn("Side story beat failed:", error); }
  }
}

// ---------------------------------------------------------------- the player's turn

const canSpeak = () => voice.mode !== "none";
const turnHint = () => canSpeak()
  ? "Hold the trigger (or Space) and speak."
  : "No speech input here. Trigger or K: respond kindly. Grip or H: respond harshly.";

function waitForPlayer() {
  if (AUTO) {
    const code = AUTO[autoIndex++ % AUTO.length];
    return sleep(FAST ? 50 : 1500).then(() => code === "U" ? { transcript: "" } : { action: code === "P" ? "POSITIVE" : "NEGATIVE" });
  }
  return new Promise((resolve) => { pendingTurn = resolve; });
}

function answer(result) {
  const resolve = pendingTurn;
  pendingTurn = null;
  mainPanel.highlight(false);
  resolve?.(result);
}

function talkStart() {
  if (!pendingTurn || talking) return;
  if (!canSpeak()) return answer({ action: "POSITIVE" });
  talking = true;
  voice.start();
  setStatus("Listening…");
}

async function talkEnd() {
  if (!talking) return;
  talking = false;
  setStatus("Thinking…");
  answer(await voice.stop());
}

const forced = (action) => { if (pendingTurn && !talking) answer({ action }); };

addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (event.code === "Space") { event.preventDefault(); talkStart(); }
  if (event.code === "KeyK") forced("POSITIVE");
  if (event.code === "KeyH") forced("NEGATIVE");
});
addEventListener("keyup", (event) => { if (event.code === "Space") talkEnd(); });

for (const index of [0, 1]) {
  const controller = renderer.xr.getController(index); // trigger, or a pinch with hand tracking
  controller.addEventListener("selectstart", talkStart);
  controller.addEventListener("selectend", talkEnd);
  controller.addEventListener("squeezestart", () => { if (!canSpeak()) forced("NEGATIVE"); });
  scene.add(controller);
}

async function interpret(transcript, actor, recipient, situation) {
  try {
    const reply = await fetch("/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, situation, actor, recipient: { name: recipient.name, appearanceDescription: recipient.appearanceDescription } }),
    });
    const verdict = await reply.json();
    if (reply.ok && ["POSITIVE", "NEGATIVE", "UNCLEAR"].includes(verdict.action)) return verdict;
  } catch (error) { console.warn("Interpreter unavailable:", error.message); }
  return { action: "UNCLEAR", beat: "" };
}

/**
 * Fallback policy: silence, a failed transcription or an unclear reply never counts as
 * negative. The player is asked once more; after that the moment passes with no change.
 */
async function playerTurn(actor, recipient, situation) {
  // Only the main story waits for the player. Side stories keep living.
  // Give Visko a few seconds to reach the new moment, then hold the picture until the player answers.
  const freeze = setTimeout(() => main.hold(true), SETTLE);
  try { return await askPlayer(actor, recipient, situation); }
  finally { clearTimeout(freeze); main.hold(false); }
}

async function askPlayer(actor, recipient, situation) {
  for (let attempt = 0; attempt < 2; attempt++) {
    mainPanel.highlight(true);
    setStatus((attempt ? "Didn't catch that. Once more: " : `${actor.name} is waiting for you. `) + turnHint());
    const input = await waitForPlayer();
    if (input.action) return { action: input.action, beat: "" };
    if (!input.transcript) continue;
    setCaption(situation, `${actor.name}: “${input.transcript}”`);
    setStatus("Thinking…");
    const verdict = await interpret(input.transcript, actor, recipient, situation);
    if (verdict.action !== "UNCLEAR") return verdict;
  }
  return { action: "NEUTRAL", beat: "" };
}

// ---------------------------------------------------------------- the story

function outcomeCaption(actor, recipient, action, types) {
  if (action === "NEGATIVE") {
    return types.includes("MONSTER_SPAWNED")
      ? `A new monster grows on ${recipient.name}'s shoulder. ${actor.name} still has theirs. The story follows ${recipient.name} now.`
      : `${recipient.name}'s monster swells back to full size. The story follows ${recipient.name} now.`;
  }
  if (types.includes("MONSTER_REMOVED")) return `${actor.name}'s monster dissolves. The ripple stops here.`;
  if (action === "POSITIVE") return `${actor.name}'s monster shrinks. One more kind answer and it is gone.`;
  return `The moment passes. Nothing changes.`;
}

async function run() {
  // Phase 1: the opening. No interaction, just how a Monster spreads.
  const first = newCharacter();
  const second = newCharacter();
  world.seed(first.characterId);
  mainPanel.setTexture(main.texture);
  setStatus("Watch.");
  setCaption(`This is ${first.name}. It has been a long day, and something has been riding on ${first.name}'s shoulder since morning.`);
  await main.show(soloPrompt(first), { cut: true });
  await sleep(HOLD);

  let scenario = pick(SCENARIOS);
  engagedId = otherId = second.characterId;
  refresh();
  setCaption(captionFor(scenario, first, second));
  await main.show(encounterPrompt(first, second, scenario));
  await sleep(HOLD * 0.7);
  otherId = first.characterId; // the main window now follows the second person; the first is the one they face
  let types = world.resolve(first.characterId, second.characterId, "NEGATIVE", "opening").map((e) => e.type);
  setCaption(`${first.name} snaps. A new monster grows on ${second.name}'s shoulder, and ${first.name} keeps the old one. Now there are two.`);
  await main.show(outcomePrompt(first, second, scenario.place, "NEGATIVE", types));
  showSide(first, soloPrompt(first, "walks away alone, still fuming"));
  sideLoop();
  await sleep(HOLD);
  otherId = null;

  // Phase 2: the player speaks for whoever the main window is following.
  while (running) {
    let actor = world.main;
    if (!actor) {
      const carrier = world.list().find((c) => c.monsterState !== NONE);
      if (!carrier) break;
      world.promote(carrier.characterId);
      refresh();
      actor = carrier;
      setStatus("");
      setCaption(`But the ripple is still moving. ${actor.name} is carrying a monster. Step into ${actor.name}'s story.`,
        actor.monsterState === SMALL ? `${actor.name} has already been kind once, so one more kind answer clears it.` : "");
      await main.show(soloPrompt(actor), { cut: true });
      await sleep(HOLD * 0.7);
    }

    const recipient = someoneToMeet(actor);
    if (!recipient) break;
    engagedId = otherId = recipient.characterId;
    refresh();
    scenario = pick(SCENARIOS);
    const situation = captionFor(scenario, actor, recipient);
    actor.currentLocation = scenario.place;
    setCaption(situation, `What does ${actor.name} say?`);
    // A new place and a new person: start a fresh run. Morphing the running picture
    // keeps the previous scene's people in frame.
    await main.show(encounterPrompt(actor, recipient, scenario), { cut: true });

    const verdict = await playerTurn(actor, recipient, situation);
    if (!running) return;
    if (verdict.action === "NEGATIVE") otherId = actor.characterId;
    types = world.resolve(actor.characterId, recipient.characterId, verdict.action, situation).map((e) => e.type);
    setStatus("");
    setCaption(outcomeCaption(actor, recipient, verdict.action, types));
    await main.show(outcomePrompt(actor, recipient, scenario.place, verdict.action, types, verdict.beat));
    if (verdict.action === "NEGATIVE") showSide(actor, soloPrompt(actor, "walks away alone, still fuming"));
    engagedId = null;
    await sleep(HOLD);
    otherId = null;
    refresh();
  }

  if (!running) return;
  const clear = world.monsterCount === 0;
  setStatus("");
  setCaption(clear ? "No monsters left in the world. The ripple stopped with you." : "The story rests here.");
  console.log("[ripple] finished, monsters:", world.monsterCount);
  document.title = `RIPPLE_DONE monsters=${world.monsterCount} characters=${world.list().length}`;
  await sleep(FAST ? 200 : 20000);
  stop(clear ? "The ripple stopped with you." : "Stopped.");
}

async function begin() {
  if (running) return;
  running = true;
  $("begin").disabled = true;
  try {
    setStatus("Checking the server");
    health = await (await fetch("/health")).json();
    await voice.init(Boolean(health.stt));
    const lost = () => { if (running) stop("The video session ended."); };
    main = new LiveStream("Main story", { mock: MOCK, onStatus: (s) => setStatus(`Main video: ${s}`), onLost: lost });
    setStatus("Connecting the video");
    await main.connect();
    $("stop").disabled = false;
    await run();
  } catch (error) {
    console.error(error);
    stop("Failed: " + error.message);
  }
}

async function stop(message = "Stopped.") {
  running = false;
  if (pendingTurn) answer({ action: "NEUTRAL" });
  for (const entry of sidePanels.values()) entry.connected.then(() => entry.stream?.close());
  await main?.close();
  setStatus(message + " Reload the page to play again.");
  $("stop").disabled = true;
}

$("begin").onclick = begin;
$("stop").onclick = () => stop();
addEventListener("pagehide", () => { main?.close(); for (const entry of sidePanels.values()) entry.stream?.close(); });

// The Enter XR button only appears where a headset is available. A desktop browser has none,
// and a headset refuses WebXR on a plain http:// address other than localhost.
const xrModes = navigator.xr
  ? await Promise.all(["immersive-ar", "immersive-vr"].map((mode) => navigator.xr.isSessionSupported(mode).catch(() => false)))
  : [];
if (xrModes.includes(true)) {
  const button = XRButton.createButton(renderer, { optionalFeatures: ["local-floor", "hand-tracking"] });
  button.style.position = "static";
  $("xr").append(button);
  renderer.xr.addEventListener("sessionstart", () => begin());
} else {
  $("xr").textContent = navigator.xr
    ? "Flat-screen preview (no headset on this device). Drag to look around."
    : "XR needs http://localhost or https. On Quest: adb reverse tcp:8787 tcp:8787, then open localhost:8787/ripple/";
}

setCaption("The Ripple. Negative moments spread from person to person, and you can stop them.", "Press Begin, allow the microphone, then enter XR.");
drawHud();
mainPanel.label("The Ripple", MOCK ? "mock video" : "");
renderer.setAnimationLoop((time) => {
  for (const panel of panels) panel.tick(time);
  renderer.render(scene, camera);
});
if (AUTO) begin();

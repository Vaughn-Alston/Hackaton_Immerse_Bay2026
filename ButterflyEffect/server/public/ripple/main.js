// The Ripple, Episode 01: The Dishwasher. WebXR app: Living Windows, choices, and the story flow.
//
// URL switches:  ?mock=1   no Reactor sessions (placeholder pictures, nothing billed)
//                ?fast=1   very short holds, for testing
//                ?auto=NPP scripted picks (N a harsh choice, P the kind one), repeating
//                ?turns=10 how many choices the player makes before evening comes
//                ?live=3   how many side windows get their own live video (default: all 8)
//                ?creatures=off  keep creatures out of the videos; the window markers are the only Monsters

import * as THREE from "three";
import { XRButton } from "three/addons/webxr/XRButton.js";
import { World, FULL, SMALL, NONE, AI_SIDE_STORY } from "./state.js";
import {
  CAST, EPISODE, scenarioFor, validChoices, captionFor, afterFor,
  soloPrompt, encounterPrompt, outcomePrompt, exitPrompt, eveningPrompt, localSideBeat, setCreatures,
} from "./content.js";
import { LiveStream } from "./stream.js";
import { layoutRadial } from "./layout.js";

const params = new URLSearchParams(location.search);
const MOCK = params.has("mock");
const FAST = params.has("fast");
const AUTO = (params.get("auto") ?? "").toUpperCase();
const TURNS = Number(params.get("turns") ?? 10);
const HOLD = FAST ? 250 : 11000;       // how long a beat plays before the story moves on
const SIDE_EVERY = FAST ? 400 : 30000; // pause between AI side-story beats
const EXIT = FAST ? 100 : 5000;         // how long we watch someone leave before their side window appears
const SETTLE = FAST ? 0 : 9000;         // how long a new moment plays before the main picture holds for the choice
const MAX_CHARACTERS = 20;
// Every live window is its own Reactor session, billed per second while it is open.
const LIVE_SIDES = Number(params.get("live") ?? 8);
setCreatures(params.get("creatures") !== "off");
// The day, one step per choice. The opening is 7:30 AM and dinner is 6:30 PM.
const CLOCK = ["7:45 AM", "8:50 AM", "9:40 AM", "10:30 AM", "11:30 AM", "12:40 PM", "1:45 PM", "3:00 PM", "4:15 PM", "5:30 PM"];

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
const camera = new THREE.PerspectiveCamera(85, innerWidth / innerHeight, 0.05, 50); // wide on a flat screen; the headset uses its own view
camera.position.set(0, 1.5, 0); // flat-screen view; in XR the headset pose replaces this
camera.rotation.order = "YXZ";
const VIEW_DISTANCE = 2.2;
const stage = new THREE.Group(); // everything hangs here, in front of the viewer
stage.position.set(0, 1.62, -VIEW_DISTANCE);
scene.add(stage);

// A dark dome around the viewer. In the headset the app runs over passthrough, and a bright room
// behind the windows washes the videos out; this hides the room behind near-black. It is opaque
// and painted before everything else, so the graph lines and the windows all sit on top of it.
const dome = new THREE.Mesh(
  new THREE.SphereGeometry(30, 32, 16),
  new THREE.MeshBasicMaterial({ color: 0x050507, side: THREE.BackSide, depthWrite: false, depthTest: false }),
);
dome.renderOrder = -100;
dome.position.set(0, 1.5, 0);
scene.add(dome);

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

  /**
   * lines: [{ text, size, color, bold }], wrapped to the plate width. If the text would run past
   * the bottom of the plate, every size is scaled down until all of it fits. Nothing is cut off.
   * background: a CSS colour, or null for no backing (the text sits on its window's card).
   */
  draw(lines, background = "rgba(12,12,14,0.86)") {
    const g = this.canvas.getContext("2d");
    const { width, height } = this.canvas;
    const shown = lines.filter((line) => line.text);
    // Lay the text out at a given scale: returns the wrapped rows and the height they need.
    const layout = (scale) => {
      const rows = [];
      let y = 18 * scale;
      for (const { text, size = 36, color = "#e8e6e3", bold = false, align = "left" } of shown) {
        const px = size * scale;
        const font = `${bold ? "600 " : ""}${px}px system-ui, sans-serif`;
        g.font = font;
        let row = "";
        for (const word of String(text).split(" ")) {
          if (row && g.measureText(row + word).width > width - 56) { y += px * 1.25; rows.push({ row, y, font, color, align }); row = ""; }
          row += word + " ";
        }
        y += px * 1.25; rows.push({ row, y, font, color, align });
        y += px * 0.3;
      }
      return { rows, bottom: y };
    };
    let scale = 1, fitted = layout(scale);
    while (fitted.bottom > height - 8 && scale > 0.45) { scale *= 0.93; fitted = layout(scale); }

    g.clearRect(0, 0, width, height);
    if (background) { g.fillStyle = background; g.beginPath(); g.roundRect(0, 0, width, height, 22); g.fill(); }
    for (const { row, y, font, color, align } of fitted.rows) {
      g.font = font; g.fillStyle = color; g.textAlign = align;
      g.fillText(row.trim(), align === "center" ? width / 2 : 28, y);
    }
    this.texture.needsUpdate = true;
  }
}

function makeMonster() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 16), new THREE.MeshBasicMaterial({ color: 0x1d1230 })));
  // A violet rim, so the dark body reads against a dark room as well as against passthrough.
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.56, 20, 16), new THREE.MeshBasicMaterial({ color: 0x7a45c8, side: THREE.BackSide })));
  for (const x of [-0.17, 0.17]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xd9bcff }));
    eye.position.set(x, 0.1, 0.44);
    group.add(eye);
  }
  group.scale.setScalar(0.0001);
  return group;
}

const MONSTER_SIZE = { [FULL]: 1, [SMALL]: 0.45, [NONE]: 0 };
const panels = new Set();

/** One Living Window: a 16:9 screen, a name plate under it, and Monsters along its top edge. */
class Panel {
  constructor(width, plateHeight = width * 0.2, platePixels = 768, tagged = false, extraBelow = 0) {
    this.width = width;
    const height = (width * 9) / 16;
    this.group = new THREE.Group();
    // The card: an outline and a dark fill behind the video, the name plate and (on the main
    // window) the caption, so the whole window reads as one framed box.
    const top = height / 2 + 0.03, bottom = -height / 2 - 0.025 - plateHeight - extraBelow - 0.03;
    this.border = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.07, top - bottom), new THREE.MeshBasicMaterial({ color: 0x2a2a30 }));
    this.border.position.set(0, (top + bottom) / 2, -0.008);
    this.backing = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.04, top - bottom - 0.03), new THREE.MeshBasicMaterial({ color: 0x0d0d11 }));
    this.backing.position.set(0, (top + bottom) / 2, -0.005);
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }));
    this.plate = new TextPlate(width, plateHeight, platePixels);
    this.plate.mesh.position.y = -height / 2 - plateHeight / 2 - 0.025;
    // Left: this window's own character. Right: the person they are facing. Centre: a third, at the dinner table.
    this.monsters = [-1, 1, 0].map((sideOfScreen) => {
      const monster = makeMonster();
      // Far enough forward that the whole ball clears the window: at full size its radius is width * 0.1.
      monster.position.set(sideOfScreen * (width / 2 - width * 0.04), height / 2, width * 0.12);
      monster.userData.target = 0;
      return monster;
    });
    this.group.add(this.border, this.backing, this.screen, this.plate.mesh, ...this.monsters);
    // On a window that shows more than one person, each marker carries its owner's name.
    this.tags = tagged ? this.monsters.map((monster) => {
      const tag = new TextPlate(width * 0.15, width * 0.042, 256);
      tag.mesh.position.set(monster.position.x, monster.position.y - width * 0.085, width * 0.235); // in front of the ball
      tag.mesh.visible = false;
      this.group.add(tag.mesh);
      return tag;
    }) : [];
    panels.add(this);
  }

  setTexture(texture) {
    this.screen.material.map = texture;
    this.screen.material.color.set(0xffffff);
    this.screen.material.needsUpdate = true;
  }

  label(name, detail, live = false) {
    this.plate.draw([
      { text: name + (live ? "  · live" : ""), size: this.featured ? 60 : 52, bold: true, color: this.featured ? "#d9bcff" : "#e8e6e3" },
      { text: detail, size: 38, color: "#b9b6ae" },
    ], null);
  }

  /** Who is at the left, right and centre positions. Each person with a Monster gets exactly one marker. */
  setMonsters(left = null, right = null, centre = null) {
    [left, right, centre].forEach((person, i) => {
      const monster = this.monsters[i];
      monster.userData.target = MONSTER_SIZE[person?.monsterState ?? NONE] * this.width * 0.2;
      monster.userData.owner = person?.characterId ?? null;
      const tag = this.tags[i];
      if (tag && person && tag.name !== person.name) {
        tag.name = person.name;
        tag.draw([{ text: person.name, size: 34, bold: true }], "rgba(29,18,48,0.92)");
      }
    });
  }
  highlight(on) { this.border.material.color.set(on ? 0x7a45c8 : 0x2a2a30); }

  /** Marks a main character's window: a thicker, bright frame. */
  feature() {
    this.featured = true;
    this.border.scale.set(1.03, 1.03, 1);
    this.border.material.color.set(0xd9bcff);
  }

  /** Starts the window, small, where its character came from. */
  startFrom(from = new THREE.Vector3(0, 0, 0.12)) {
    this.group.rotation.order = "YXZ";
    this.group.position.copy(from);
    this.group.scale.setScalar(0.35);
  }

  /** Where the layout wants this window. It eases there, turned and tilted to face the viewer. */
  glideTo(position, rotationY, rotationX, scale) { this.home = { position, rotationY, rotationX, scale }; }

  tick(time) {
    if (this.home) {
      const ease = FAST ? 1 : 0.07; // test runs jump straight into place
      this.group.position.lerp(this.home.position, ease);
      this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, this.home.rotationY, ease);
      this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, this.home.rotationX, ease);
      this.group.scale.setScalar(THREE.MathUtils.lerp(this.group.scale.x, this.home.scale, ease));
    }
    for (const m of this.monsters) {
      m.userData.size = THREE.MathUtils.lerp(m.userData.size ?? 0, m.userData.target, 0.06);
      m.scale.setScalar(Math.max(m.userData.size, 0.0001) * (1 + 0.04 * Math.sin(time * 0.004)));
      m.visible = m.userData.size > 0.002;
    }
    this.tags.forEach((tag, i) => { tag.mesh.visible = this.monsters[i].userData.size > this.width * 0.04; });
  }

  dispose() { panels.delete(this); this.group.removeFromParent(); }
}

const CAPTION_HEIGHT = 0.36;
const mainPanel = new Panel(1.6, 0.2, 1280, true, CAPTION_HEIGHT + 0.02); // name plate ends at y = -0.675, the card at about -1.09
stage.add(mainPanel.group);

const hud = new TextPlate(1.6, 0.17);
hud.mesh.position.y = 0.45 + 0.24; // clear of the Monsters on the window's top edge
const caption = new TextPlate(1.6, CAPTION_HEIGHT);
caption.mesh.position.y = -0.675 - 0.02 - CAPTION_HEIGHT / 2; // inside the main window's card, under the name
stage.add(hud.mesh, caption.mesh);

// Side windows are placed by layoutRadial(): rings around the main window, like a network diagram.
const MAX_SIDES = 8;
const sidePanels = new Map(); // characterId -> { panel, detail, stream, connected, live }

// ---------------------------------------------------------------- choices

// Three identical plates in one row under the caption. Point and pull the trigger, click, or press 1 / 2 / 3.
const choiceButtons = [0, 1, 2].map((index) => {
  const plate = new TextPlate(0.72, 0.38, 720);
  const border = new THREE.Mesh(new THREE.PlaneGeometry(0.735, 0.395), new THREE.MeshBasicMaterial({ color: 0x3a3a40 }));
  border.position.z = -0.004;
  const group = new THREE.Group();
  group.add(border, plate.mesh);
  group.position.set((index - 1) * 0.75, -1.32, 0.02); // just under the main window's card
  group.visible = false;
  plate.mesh.userData.choiceIndex = index;
  stage.add(group);
  return { plate, border, group };
});
const choiceMeshes = choiceButtons.map((button) => button.plate.mesh);
let pendingChoice = null; // { choices, resolve } while the player is deciding
let hovered = -1;

function drawChoice(index, lit) {
  const button = choiceButtons[index];
  button.plate.draw([
    { text: String(index + 1), size: 30, color: "#8d8a84", bold: true },
    { text: pendingChoice?.choices[index].label ?? "", size: 56 },
  ], lit ? "rgba(44,36,60,0.96)" : "rgba(18,18,22,0.92)");
  button.border.material.color.set(lit ? 0xb48cff : 0x3a3a40);
}

function setHover(index) {
  if (index === hovered) return;
  const previous = hovered;
  hovered = index;
  if (!pendingChoice) return;
  if (previous >= 0) drawChoice(previous, false);
  if (index >= 0) drawChoice(index, true);
}

/** Shows three choices and resolves with the one the player picks. */
function offerChoices(choices) {
  return new Promise((resolve) => {
    pendingChoice = { choices, resolve };
    hovered = -1;
    choiceButtons.forEach((button, index) => { drawChoice(index, false); button.group.visible = true; });
  });
}

function choose(index) {
  if (!pendingChoice || index < 0 || index > 2) return;
  const { choices, resolve } = pendingChoice;
  pendingChoice = null;
  hovered = -1;
  for (const button of choiceButtons) button.group.visible = false;
  resolve(choices[index]);
}

const raycaster = new THREE.Raycaster();
const rayMatrix = new THREE.Matrix4();

function choiceUnder(controller) {
  rayMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rayMatrix);
  return raycaster.intersectObjects(choiceMeshes)[0]?.object.userData.choiceIndex ?? -1;
}

const controllers = [0, 1].map((index) => {
  const controller = renderer.xr.getController(index); // trigger, or a pinch with hand tracking
  const ray = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -3)]),
    new THREE.LineBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.6 }),
  );
  ray.visible = false;
  controller.add(ray);
  controller.addEventListener("select", () => { if (pendingChoice) choose(choiceUnder(controller)); });
  scene.add(controller);
  return { controller, ray };
});

// Flat screen: drag to look around at the side windows; move over a choice to light it, click to pick it.
const pointer = new THREE.Vector2();
let dragged = 0;
renderer.domElement.addEventListener("pointerdown", () => { dragged = 0; });
renderer.domElement.addEventListener("pointermove", (event) => {
  if (renderer.xr.isPresenting) return;
  if (event.buttons) {
    dragged += Math.abs(event.movementX) + Math.abs(event.movementY);
    camera.rotation.y = THREE.MathUtils.clamp(camera.rotation.y + event.movementX * 0.004, -1.6, 1.6);
    camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x + event.movementY * 0.004, -0.6, 0.9);
  }
  pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  if (pendingChoice) {
    raycaster.setFromCamera(pointer, camera);
    setHover(raycaster.intersectObjects(choiceMeshes)[0]?.object.userData.choiceIndex ?? -1);
  }
});
// Flat screen: scroll to zoom out and take in the whole graph, or in to watch one window.
renderer.domElement.addEventListener("wheel", (event) => {
  if (renderer.xr.isPresenting) return;
  event.preventDefault();
  camera.fov = THREE.MathUtils.clamp(camera.fov + event.deltaY * 0.03, 35, 110);
  camera.updateProjectionMatrix();
}, { passive: false });
renderer.domElement.addEventListener("click", () => { if (pendingChoice && dragged < 6 && hovered >= 0) choose(hovered); });
addEventListener("keydown", (event) => {
  if (!event.repeat && ["Digit1", "Digit2", "Digit3"].includes(event.code)) choose(Number(event.code.slice(-1)) - 1);
});

// ---------------------------------------------------------------- state

const world = new World();
let main, health = {};
let running = false, phase = "day", clock = "7:30 AM", engagedId = null, otherId = null, autoIndex = 0, sideTurn = 0;
let family = []; // [mom, dad, child]
const heldBack = new Set(); // still leaving the main scene: no side window yet
const busy = new Set();     // in the middle of a side-story interaction
let hudStatus = "";

/** Adds someone new to the world: the director's invention if it gave one, otherwise the next unused cast member. */
function newCharacter(custom, kid = false) {
  if (world.list().length >= MAX_CHARACTERS) return null;
  const taken = new Set(world.list().map((c) => c.name.toLowerCase()));
  if (custom?.name && custom?.appearanceDescription && !taken.has(custom.name.toLowerCase())) {
    return world.add({ ...custom, characterId: "person_" + custom.name.toLowerCase().replace(/\W+/g, "_") });
  }
  const next = CAST.find((c) => !taken.has(c.name.toLowerCase()) && c.kid === kid);
  return next ? world.add(next) : null;
}

/**
 * Someone for `actor` to run into. The director may ask for a character who already exists,
 * so storylines can cross; otherwise a new face, and once the cast runs out, someone already met.
 */
function someoneToMeet(actor, custom, existingId) {
  const free = (c) => c !== actor && c.characterId !== world.mainId && c.characterId !== engagedId && !busy.has(c.characterId);
  const known = existingId ? world.get(existingId) : null;
  if (known && free(known)) return known;
  const others = world.list().filter(free);
  return newCharacter(custom, actor.kid) ?? pick(others.filter((c) => c.kid === actor.kid)) ?? pick(others) ?? null;
}

function setCaption(text, detail = "") {
  caption.draw([{ text, size: 42 }, { text: detail, size: 34, color: "#b9b6ae" }], null);
}

function drawHud() {
  hud.draw([
    { text: `Monsters in the world: ${world.monsterCount}`, size: 50, bold: true, color: world.monsterCount ? "#b48cff" : "#8fd694", align: "center" },
    { text: hudStatus, size: 36, color: "#b9b6ae", align: "center" }, // the time of day is not shown; only the director uses it
  ]);
  $("status").textContent = `${world.monsterCount} monster(s). ${hudStatus}`;
}
const setStatus = (text) => { hudStatus = text; drawHud(); };

const describe = (c) => c.monsterState === NONE ? "no monster" : c.monsterState === SMALL ? "small monster" : "carrying a monster";
const isFamily = (c) => family.includes(c);

/** Brings windows, labels and Monsters in line with the world state. */
function refresh() {
  const evening = phase === "dinner";
  for (const c of world.list()) {
    // During the day a side window exists only while its character carries a Monster.
    // In the evening everyone we met, outside the family, gets a window.
    const isSide = evening ? !isFamily(c) : c.storyMode === AI_SIDE_STORY && c.monsterState !== NONE && !heldBack.has(c.characterId);
    if (isSide && !sidePanels.has(c.characterId) && sidePanels.size < MAX_SIDES) {
      const panel = new Panel(0.78);
      // The window branches out from whoever gave this person their Monster (or from the main window).
      const source = links.findLast((link) => link.to === c.characterId);
      panel.startFrom(source && sidePanels.get(source.from)?.panel.group.position.clone() || undefined);
      // Mom, Dad and Mia are the main characters: their windows are bigger and brightly framed.
      if (isFamily(c)) panel.feature();
      stage.add(panel.group);
      const entry = { panel, detail: "", stream: null, connected: Promise.resolve(false), live: false };
      if ([...sidePanels.values()].filter((e) => e.stream).length < LIVE_SIDES) {
        entry.stream = new LiveStream(c.name, { mock: MOCK });
        entry.connected = entry.stream.connect().then(() => true, (error) => {
          console.warn(`No live video for ${c.name}:`, error.message); // the window stays, its state still moves
          return false;
        });
      }
      sidePanels.set(c.characterId, entry);
      c.activeWindowId = "window_" + c.characterId;
      if (evening) showSide(c, eveningPrompt(c));
    }
    if (!isSide && sidePanels.has(c.characterId)) {
      const entry = sidePanels.get(c.characterId);
      if (evening || c.storyMode !== AI_SIDE_STORY) closeSide(c.characterId); // back with the family, or in the main story
      else if (!entry.closing) {
        // Monster gone: let the dissolve play, then the window leaves the network.
        entry.closing = true;
        entry.panel.setMonsters(null);
        entry.panel.label(c.name, entry.detail, entry.live);
        setTimeout(() => { if (sidePanels.get(c.characterId) === entry && entry.closing) closeSide(c.characterId); refresh(); }, HOLD);
      }
    }
  }
  for (const [id, entry] of sidePanels) {
    const c = world.get(id);
    if (entry.closing && (evening || c.monsterState !== NONE)) entry.closing = false; // caught a new one, or evening came
    if (entry.closing) continue;
    entry.panel.setMonsters(c);
    entry.panel.label(c.name, entry.detail, entry.live); // just the name until an interaction has played
  }

  if (evening) {
    const [mom, dad, child] = family;
    mainPanel.setMonsters(mom, dad, child);
    mainPanel.label("Dinner", family.map((c) => `${c.name}: ${describe(c)}`).join("   ·   "));
  } else {
    const lead = world.main;
    const other = otherId && otherId !== world.mainId ? world.get(otherId) : null;
    mainPanel.setMonsters(lead, other);
    if (lead) {
      mainPanel.label(lead.name, describe(lead) + (other ? `   ·   ${other.name}: ${describe(other)}` : ""));
      lead.activeWindowId = "window_main";
    }
  }
  drawHud();
  arrangeWindows();
  // Now that every window is in place, let any newly spawned Monster split off and travel to its new host.
  for (const link of links) if (!link.copied) { link.copied = true; flyCopy(link); }
}

world.on((event) => {
  if (event.type !== "WORLD_STATE_UPDATED") console.log("[ripple]", event.type, event.characterId ?? `${event.actorId}->${event.recipientId} ${event.action}`);
  else { console.log("[ripple] monsters:", event.monsterCount); refresh(); }
  // The ripple graph: one link for every time someone gave someone else a Monster.
  if (event.type === "MONSTER_SPAWNED" && event.from) {
    links.push({ from: event.from, to: event.characterId, born: performance.now(), copied: false });
    console.log("[ripple] link:", event.from, "->", event.characterId);
  }
});

// ---------------------------------------------------------------- the ripple graph

// Every window is a node. A straight line with an arrow runs from whoever was harsh to the person
// who caught a Monster from them. Lines are background: they are painted first and ignore depth,
// so every window, label and Monster marker is drawn in front of them.
const links = [];
const LINK_GROW = FAST ? 200 : 1400; // how long a new line takes to draw itself outward
const linkMaterial = new THREE.MeshBasicMaterial({ color: 0x8a5fe0, depthTest: false, depthWrite: false });
const linkGeometry = new THREE.CylinderGeometry(0.02, 0.02, 1, 6);
const arrowGeometry = new THREE.ConeGeometry(0.075, 0.2, 12); // points along +Y, like the line
// Arrowheads repeat along the whole line and flow from whoever was harsh toward whoever was hurt,
// so the direction reads on any stretch of line that shows between the windows.
const ARROW_SPACING = 0.55;                // backdrop metres between arrowheads
const ARROW_SPEED = FAST ? 0 : 0.00022;    // spacings per millisecond
// Lines are drawn on a backdrop this far from the viewer, straight behind each window. A line
// between a left and a right window would otherwise cut through the space right in front of you.
const BACKDROP = 6;
const viewer = new THREE.Vector3(0, 0, VIEW_DISTANCE); // where the viewer stands, in stage space
const BEHIND = -10; // render order: before every window
const UP = new THREE.Vector3(0, 1, 0);
const endA = new THREE.Vector3(), endB = new THREE.Vector3(), along = new THREE.Vector3();

/** Characters shown in the main window. They are the centre of the graph. */
function hubIds() {
  if (phase === "dinner") return new Set(family.map((c) => c.characterId));
  return new Set([world.mainId, otherId].filter(Boolean));
}

/**
 * Re-runs the radial layout and tells every side window where to glide. Called whenever a
 * window appears or leaves, a link is added, or the main window follows someone new.
 */
function arrangeWindows() {
  const placement = layoutRadial([...sidePanels.keys()], links, hubIds(), new Set(family.map((c) => c.characterId)));
  for (const [id, entry] of sidePanels) {
    const place = placement.get(id);
    // The layout is flat (metres right of and above the main window). Wrap it around the viewer,
    // who stands at (0, 0, VIEW_DISTANCE) in stage space, so every window faces them.
    const yaw = place.x / VIEW_DISTANCE, pitch = place.y / VIEW_DISTANCE;
    const position = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch) * VIEW_DISTANCE,
      Math.sin(pitch) * VIEW_DISTANCE,
      VIEW_DISTANCE - Math.cos(yaw) * Math.cos(pitch) * VIEW_DISTANCE,
    );
    entry.panel.glideTo(position, -yaw, pitch, place.scale); // the layout already made family windows larger
  }
}

/** The window a character is shown in right now: the main window, their side window, or none. */
function windowOf(id) {
  const onMain = phase === "dinner" ? family.some((c) => c.characterId === id) : id === world.mainId || id === otherId;
  return onMain ? mainPanel : sidePanels.get(id)?.panel ?? null;
}

/** The two ends of a link (from -> to): the centres of the two windows, or false if there is nothing to draw. */
function linkEnds(link, a, b) {
  const from = windowOf(link.from), to = windowOf(link.to);
  if (!from || !to || from === to) return false;
  for (const [panel, end] of [[from, a], [to, b]]) {
    stage.worldToLocal(panel.group.getWorldPosition(end));
    end.sub(viewer).setLength(BACKDROP).add(viewer); // pushed out along the line of sight
  }
  return true;
}

function tickLinks(now) {
  for (const link of links) {
    if (!link.mesh) {
      link.mesh = new THREE.Mesh(linkGeometry, linkMaterial);
      link.mesh.renderOrder = BEHIND;
      link.arrows = []; // arrowheads, made as the line needs them
      stage.add(link.mesh);
    }
    const show = linkEnds(link, endA, endB);
    link.mesh.visible = show;
    if (!show) { for (const arrow of link.arrows) arrow.visible = false; continue; }
    const grown = Math.min((now - link.born) / LINK_GROW, 1);
    along.subVectors(endB, endA);
    const length = along.length();
    link.mesh.quaternion.setFromUnitVectors(UP, along.normalize());
    link.mesh.scale.set(1, Math.max(length * grown, 0.001), 1);
    link.mesh.position.copy(endA).addScaledVector(along, (length * grown) / 2);
    const count = Math.max(2, Math.round(length / ARROW_SPACING));
    while (link.arrows.length < count) {
      const arrow = new THREE.Mesh(arrowGeometry, linkMaterial);
      arrow.renderOrder = BEHIND;
      stage.add(arrow);
      link.arrows.push(arrow);
    }
    const flow = (now * ARROW_SPEED) % 1;
    link.arrows.forEach((arrow, i) => {
      const t = (i + flow) / count; // 0 at the harsh end, 1 at the hurt end
      arrow.visible = i < count && t <= grown;
      arrow.quaternion.copy(link.mesh.quaternion);
      arrow.position.copy(endA).addScaledVector(along, length * t);
    });
  }
}

// A Monster never moves from one person to another: the original stays, and a copy travels.
const copies = [];
function flyCopy(link) {
  const marker = makeMonster();
  stage.add(marker);
  copies.push({ link, marker, born: performance.now() });
}

function tickCopies(now) {
  const flight = FAST ? 200 : 1600;
  for (let i = copies.length - 1; i >= 0; i--) {
    const { link, marker, born } = copies[i];
    const t = (now - born) / flight;
    if (t >= 1 || !linkEnds(link, endA, endB)) { marker.removeFromParent(); copies.splice(i, 1); continue; }
    // The copy flies in front of the windows, at their distance, above the line it follows.
    marker.position.lerpVectors(endA, endB, t * t * (3 - 2 * t)).sub(viewer).setLength(VIEW_DISTANCE - 0.35).add(viewer);
    marker.scale.setScalar(0.05 + 0.07 * t);
  }
}

// ---------------------------------------------------------------- side stories

/** Removes a side window and ends its video session, even one that is still connecting. */
function closeSide(id) {
  const entry = sidePanels.get(id);
  if (!entry) return;
  sidePanels.delete(id);
  console.log("[ripple] side window closed:", id, "windows left:", sidePanels.size);
  entry.panel.dispose();
  entry.connected.then(() => entry.stream?.close());
}

/** Sends a new beat to `character`'s own side window. */
async function showSide(character, prompt, cut = false) {
  const id = character.characterId;
  const entry = sidePanels.get(id);
  try {
    if (!entry?.stream || !(await entry.connected) || sidePanels.get(id) !== entry) return;
    await entry.stream.show(prompt); // always a fresh run: see LiveStream.show
    if (sidePanels.get(id) !== entry || entry.live) return;
    entry.live = true;
    entry.panel.setTexture(entry.stream.texture);
    refresh();
  } catch (error) { console.warn(`Side video for ${character.name} failed:`, error.message); }
}

/** Asks the Global Story Director (Claude, on the server) for a plan. It sees the whole world. */
async function askDirector(request) {
  if (!health.claude) return null;
  try {
    const reply = await fetch("/direct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, clock, world: world.list(), mainId: world.mainId, engagedId }),
    });
    if (reply.ok) return await reply.json();
  } catch (error) { console.warn("Director unavailable:", error.message); }
  return null;
}

/** Which side character acts next, and what they do. Falls back to a written beat without the director. */
async function proposeSideBeat(carriers) {
  const plan = await askDirector({ mode: "side", candidates: carriers.map((c) => c.characterId) });
  const chosen = plan && carriers.find((c) => c.characterId === plan.actorId);
  if (chosen && (plan.action === "POSITIVE" || plan.action === "NEGATIVE") && plan.place) return { actor: chosen, beat: plan };
  const actor = carriers[sideTurn % carriers.length];
  const local = localSideBeat(actor);
  return { actor, beat: { action: local.action, place: local.scenario.place, beat: local.beat, other: null, otherId: "", caption: "" } };
}

/** What the rules will do with this interaction, worked out without changing anything. */
function predictTypes(actor, other, action) {
  if (action === "NEGATIVE") return [other.monsterState === NONE ? "MONSTER_SPAWNED" : "MONSTER_REGROWN"];
  return [actor.monsterState === SMALL ? "MONSTER_REMOVED" : "MONSTER_SHRUNK"];
}

/**
 * One step in one side story. The director only proposes; the state manager decides what changes.
 * The interaction plays in the window first. Its result (label, Monster, world count) is only
 * applied and shown once it has played.
 */
async function sideBeat() {
  const carriers = world.list().filter((c) => c.storyMode === AI_SIDE_STORY && c.monsterState !== NONE
    && !heldBack.has(c.characterId) && !(phase === "dinner" && isFamily(c)));
  if (!carriers.length) return;
  sideTurn++;
  let reserved = [];
  try {
    const { actor, beat } = await proposeSideBeat(carriers);
    if (!running || actor.storyMode !== AI_SIDE_STORY || actor.monsterState === NONE) return;
    const other = someoneToMeet(actor, beat.other, beat.otherId);
    if (!other || (phase === "dinner" && isFamily(other))) return;
    reserved = [actor.characterId, other.characterId];
    for (const id of reserved) busy.add(id);

    actor.currentLocation = beat.place;
    showSide(actor, outcomePrompt(actor, other, beat.place, beat.action, predictTypes(actor, other, beat.action), beat.beat), beat.action === "NEGATIVE");
    await sleep(HOLD);
    if (!running || actor.storyMode !== AI_SIDE_STORY || actor.monsterState === NONE) return; // the story moved on meanwhile

    const types = world.resolve(actor.characterId, other.characterId, beat.action, beat.caption).map((e) => e.type);
    const entry = sidePanels.get(actor.characterId);
    if (entry) {
      // Always say where the Monster stands, so one kind act is not mistaken for the end.
      const progress = beat.action === "NEGATIVE" ? (types.includes("MONSTER_REGROWN") ? "Monster back to full size." : "")
        : types.includes("MONSTER_REMOVED") ? "Kind twice: monster gone." : "Kind 1 of 2: monster shrinks.";
      const what = beat.caption || (beat.action === "NEGATIVE" ? `takes it out on ${other.name}` : `is kind to ${other.name}`);
      entry.detail = `${what.replace(/\.$/, "")}. ${progress}`.trim();
    }
    refresh();
    if (types.includes("SIDE_STORY_CREATED")) showSide(other, soloPrompt(other, "walks on alone, hurt and trying not to show it"));
  } catch (error) { console.warn("Side story beat failed:", error); }
  finally { for (const id of reserved) busy.delete(id); }
}

async function sideLoop() {
  while (running && phase === "day") {
    await sleep(SIDE_EVERY);
    if (running && phase === "day") await sideBeat();
  }
}

// ---------------------------------------------------------------- the main story

/** The next encounter for the player's character: who they meet, where, what happens, and the three choices. */
async function planEncounter(actor) {
  const plan = await askDirector({ mode: "main", actorId: actor.characterId });
  let recipient = null, scenario = null;
  if (plan?.place && plan?.provocation && plan?.caption && validChoices(plan.choices)) {
    recipient = someoneToMeet(actor, plan.other, plan.otherId);
    scenario = { place: plan.place, visual: "{r} " + plan.provocation, caption: plan.caption, choices: plan.choices };
  }
  recipient ??= someoneToMeet(actor);
  if (!recipient) return null;
  engagedId = recipient.characterId; // reserved: side stories leave this person alone
  return { actorId: actor.characterId, recipient, scenario: scenario ?? scenarioFor(actor) };
}

/** Offers the three choices in shuffled order. The main picture plays a few seconds, then holds until one is picked. */
async function chooseFor(actor, scenario) {
  const choices = [...scenario.choices].sort(() => Math.random() - 0.5);
  if (AUTO) {
    const wanted = AUTO[autoIndex++ % AUTO.length] === "P" ? "POSITIVE" : "NEGATIVE";
    await sleep(FAST ? 50 : 1500);
    return choices.find((c) => c.action === wanted);
  }
  mainPanel.highlight(true);
  setStatus(""); // no instructions under the count: the three choices speak for themselves
  const freeze = setTimeout(() => main.hold(true), SETTLE);
  try { return await offerChoices(choices); }
  finally { clearTimeout(freeze); main.hold(false); mainPanel.highlight(false); }
}

function outcomeCaption(actor, recipient, action, types) {
  if (action === "NEGATIVE") {
    return types.includes("MONSTER_SPAWNED")
      ? `A new monster grows on ${recipient.name}'s shoulder. ${actor.name} keeps theirs. The story follows ${recipient.name} now.`
      : `${recipient.name}'s monster swells back to full size. The story follows ${recipient.name} now.`;
  }
  if (types.includes("MONSTER_REMOVED")) return `Kind twice. ${actor.name}'s monster is gone.`;
  return `${actor.name}'s monster shrinks. It will take one more.`;
}

/** After an arc ends, the main window steps into another carrier's story: family first, then anyone. */
function nextCarrier() {
  const carriers = world.list().filter((c) => c.monsterState !== NONE);
  return ["child", "mom", "dad"].map((role) => carriers.find((c) => c.role === role)).find(Boolean) ?? carriers[0] ?? null;
}

// Scene 1: an ordinary morning. No interaction, just how a Monster spreads.
async function sceneKitchen() {
  const [mom, dad, child] = family = [world.add(EPISODE.mom), world.add(EPISODE.dad), world.add(EPISODE.child)];
  world.seed(mom.characterId);
  mainPanel.setTexture(main.texture);
  engagedId = otherId = dad.characterId;
  refresh();
  setStatus("");
  setCaption("The dishwasher is full of last night's dishes. Nobody started it.", "Mom is already tired. Something small and dark is sitting on her shoulder.");
  await main.show(EPISODE.kitchenPrompt(mom), { cut: true });
  await sleep(HOLD);

  setCaption("MOM: “Why didn't you start the dishwasher last night?”", "DAD: “Sorry. I forgot.”  He cleaned the whole kitchen last night. He doesn't say so.");
  otherId = null; // the main window now follows Dad, and the shot shows him alone
  heldBack.add(mom.characterId); // her side window waits until we have seen the scene break up
  const types = world.resolve(mom.characterId, dad.characterId, "NEGATIVE", "the dishwasher").map((e) => e.type);
  await main.show(outcomePrompt(mom, dad, EPISODE.kitchenPlace, "NEGATIVE", types, "turns from the open dishwasher and asks a sharp, tired question"), { cut: true });
  await sleep(HOLD);

  setCaption("A new monster grows on Dad's shoulder. Mom keeps hers. Now there are two.", "Dad turns away without another word.");
  otherId = null; // only Dad is in the picture now, so only his Monster marker shows on the main window
  refresh();
  await main.show(EPISODE.dadLeavesPrompt(mom, dad));
  await sleep(HOLD * 0.7);
  setCaption("The story follows Dad.", "Mom's morning goes on without us.");
  heldBack.delete(mom.characterId);
  refresh(); // now her Living Window appears and drifts out to the side
  showSide(mom, EPISODE.momAlonePrompt(mom));
  sideLoop();
  await sleep(EXIT);
  otherId = null;
  engagedId = child.characterId;
  return { actorId: dad.characterId, recipient: child, scenario: EPISODE.hallway }; // Scene 2 is fixed
}

// Scenes 2 and 3: the hallway, then the day. The player chooses for whoever the main window follows.
async function theDay(firstPlan) {
  let planned = Promise.resolve(firstPlan);
  for (let turn = 0; running && turn < TURNS && world.monsterCount > 0; turn++) {
    clock = CLOCK[Math.min(turn, CLOCK.length - 1)];
    let actor = world.main;
    if (!actor) {
      actor = nextCarrier();
      if (!actor) break;
      world.promote(actor.characterId);
      refresh();
      setStatus("");
      setCaption(`The ripple is still moving. ${actor.name} is carrying a monster. Step into ${actor.name}'s day.`,
        actor.monsterState === SMALL ? `${actor.name} has already been kind once. One more clears it.` : "");
      await main.show(soloPrompt(actor), { cut: true });
      planned = planEncounter(actor);
      await sleep(HOLD * 0.7);
    }

    // The director planned this encounter while the last beat was playing.
    let plan = await planned;
    if (!plan || plan.actorId !== actor.characterId) plan = await planEncounter(actor);
    if (!plan) break;
    const { recipient, scenario } = plan;
    engagedId = otherId = recipient.characterId;
    refresh();
    actor.currentLocation = scenario.place;
    setCaption(captionFor(scenario, actor, recipient));
    // A new place and a new person: start a fresh run. Morphing the running picture
    // keeps the previous scene's people in frame.
    await main.show(encounterPrompt(actor, recipient, scenario), { cut: true });

    const picked = await chooseFor(actor, scenario);
    if (!running || !picked) return;
    const leaves = picked.action === "NEGATIVE";
    if (leaves) { otherId = null; heldBack.add(actor.characterId); } // the next shot shows the hurt person alone
    const types = world.resolve(actor.characterId, recipient.characterId, picked.action, captionFor(scenario, actor, recipient)).map((e) => e.type);
    setStatus("");
    setCaption(afterFor(picked, actor, recipient), outcomeCaption(actor, recipient, picked.action, types));
    // Every outcome is a fresh run, so a creature from the previous picture cannot linger beside the new one.
    await main.show(outcomePrompt(actor, recipient, scenario.place, picked.action, types, picked.beat));
    engagedId = null;
    planned = world.main && turn + 1 < TURNS ? planEncounter(world.main) : Promise.resolve(null);
    await sleep(HOLD);
    if (leaves) {
      // Watch them go before their own Living Window appears.
      setCaption(`${actor.name} walks away.`, `${actor.name}'s day goes on without us.`);
      otherId = null; // only the person left behind is in the picture now
      refresh();
      await main.show(exitPrompt(actor, recipient, scenario.place));
      await sleep(EXIT);
      heldBack.delete(actor.characterId);
      refresh();
      showSide(actor, soloPrompt(actor, "walks on alone, still wound tight"));
    }
    otherId = null;
    refresh();
  }
}

// Scene 4: back to the dinner table. Everyone carries exactly what the day left them with.
async function sceneDinner() {
  const [mom, dad, child] = family;
  phase = "dinner";
  clock = "6:30 PM";
  engagedId = otherId = null;
  setStatus("");
  setCaption("The same kitchen. A different evening.", "Dinner is ready. For a moment everything looks ordinary again.");
  await main.show(EPISODE.dinnerPrompt(mom, dad, child), { cut: true });
  refresh(); // the family leaves the side windows; everyone else we met gets an evening window
  for (const [id, entry] of sidePanels) { entry.detail = ""; showSide(world.get(id), eveningPrompt(world.get(id))); }
  refresh();
  await sleep(HOLD);

  setCaption("MIA: “Can you pass me the water?”   “Here you go.”", "Nobody mentions the dishwasher. In the background, it is running quietly.");
  await sleep(HOLD);

  // The camera pulls back: the kitchen becomes one Living Window among the others.
  setCaption("Everyone we met is living their own evening.", "Some still carry monsters. Some carry smaller ones. Some have none.");
  const pullMs = FAST ? 300 : 5000;
  const started = performance.now();
  const pull = setInterval(() => {
    const t = Math.min((performance.now() - started) / pullMs, 1);
    const eased = t * t * (3 - 2 * t);
    stage.position.z = -VIEW_DISTANCE - 1.1 * eased;
    mainPanel.group.scale.setScalar(1 - 0.35 * eased);
  }, 16);
  // The world is still alive: two more real beats start in the side windows while we pull back.
  // They are not waited for, so the ending keeps moving.
  sideBeat().then(() => running && sideBeat());
  await sleep(pullMs + (FAST ? 100 : 1500));
  clearInterval(pull);

  setCaption("The world is not completely healed. And it is not completely broken.");
  await sleep(FAST ? 150 : 4000);
  await showTitle();
}

async function showTitle() {
  // Fade to black, then the title, close enough to read over everything else.
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 }));
  shade.position.set(0, 1.5, -1.6);
  const title = new TextPlate(1.3, 0.42);
  title.draw([{ text: "THE RIPPLE", size: 120, bold: true }, { text: "The ripple can stop with you.", size: 52, color: "#b9b6ae" }], "rgba(0,0,0,0)");
  title.mesh.position.set(0.12, 1.5, -1.5);
  title.mesh.material.opacity = 0;
  scene.add(shade, title.mesh);
  const fadeMs = FAST ? 200 : 2200;
  const started = performance.now();
  await new Promise((resolve) => {
    const fade = setInterval(() => {
      const t = Math.min((performance.now() - started) / fadeMs, 1);
      shade.material.opacity = 0.94 * t;
      title.mesh.material.opacity = t;
      if (t >= 1) { clearInterval(fade); resolve(); }
    }, 16);
  });
  setCaption("THE RIPPLE", "The ripple can stop with you.");
  console.log("[ripple] finished, monsters:", world.monsterCount, "family:", family.map((c) => `${c.name}=${c.monsterState}`).join(" "));
  document.title = `RIPPLE_DONE monsters=${world.monsterCount} characters=${world.list().length}`;
  await sleep(FAST ? 200 : 12000);
}

async function run() {
  const firstPlan = await sceneKitchen();
  await theDay(firstPlan);
  if (!running) return;
  await sceneDinner();
  if (running) stop("It was never really about the dishwasher.");
}

async function begin() {
  if (running) return;
  running = true;
  $("begin").disabled = true;
  try {
    setStatus("Checking the server");
    health = await (await fetch("/health")).json();
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
  if (pendingChoice) { pendingChoice.resolve(null); pendingChoice = null; }
  for (const button of choiceButtons) button.group.visible = false;
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
    ? "Flat-screen preview (no headset on this device). Drag to look around, scroll to zoom."
    : "XR needs http://localhost or https. On Quest: adb reverse tcp:8787 tcp:8787, then open localhost:8787/ripple/";
}

setCaption("The Ripple. Episode 01: The Dishwasher.", "Press Begin, then enter XR.");
drawHud();
mainPanel.label("The Ripple", MOCK ? "mock video" : "It was never really about the dishwasher.");
renderer.setAnimationLoop((time) => {
  for (const panel of panels) panel.tick(time);
  tickLinks(performance.now());
  tickCopies(performance.now());
  // In the headset, light up the choice a controller is pointing at.
  if (renderer.xr.isPresenting) {
    for (const { ray } of controllers) ray.visible = Boolean(pendingChoice);
    if (pendingChoice) setHover(Math.max(...controllers.map(({ controller }) => choiceUnder(controller))));
  }
  renderer.render(scene, camera);
});
if (AUTO || params.has("begin")) begin(); // ?begin=1 starts without a click (flat screen only)

// Rules of The Ripple's state manager. Run with `npm test` in server/.
import test from "node:test";
import assert from "node:assert/strict";
import { World, FULL, SMALL, NONE, PLAYER_MAIN, AI_SIDE_STORY, ARC_COMPLETE } from "./public/ripple/state.js";

function setup() {
  const world = new World();
  for (const id of ["a", "b", "c", "d"]) world.add({ characterId: id, name: id.toUpperCase(), appearanceDescription: id });
  world.seed("a");
  return world;
}
const types = (events) => events.map((e) => e.type);

test("a negative response spawns a new Monster and the actor keeps theirs", () => {
  const world = setup();
  const events = types(world.resolve("a", "b", "NEGATIVE"));
  assert.equal(world.get("a").monsterState, FULL);
  assert.equal(world.get("b").monsterState, FULL);
  assert.equal(world.monsterCount, 2);
  assert.ok(events.includes("MONSTER_SPAWNED"));
});

test("a negative response from the main character hands the main story to the recipient", () => {
  const world = setup();
  const events = types(world.resolve("a", "b", "NEGATIVE"));
  assert.equal(world.mainId, "b");
  assert.equal(world.get("a").storyMode, AI_SIDE_STORY);
  assert.equal(world.get("b").storyMode, PLAYER_MAIN);
  assert.ok(events.includes("SIDE_STORY_CREATED") && events.includes("MAIN_CHARACTER_CHANGED"));
});

test("one positive shrinks, a second in a row removes and ends the main arc", () => {
  const world = setup();
  world.resolve("a", "b", "POSITIVE");
  assert.equal(world.get("a").monsterState, SMALL);
  assert.equal(world.get("b").monsterState, NONE);
  assert.equal(world.monsterCount, 1); // shrinking does not change the count
  assert.equal(world.mainId, "a");     // the main story stays with the same character
  const events = types(world.resolve("a", "c", "POSITIVE"));
  assert.equal(world.get("a").monsterState, NONE);
  assert.equal(world.monsterCount, 0);
  assert.equal(world.get("a").storyMode, ARC_COMPLETE);
  assert.equal(world.mainId, null);
  assert.ok(events.includes("MONSTER_REMOVED") && events.includes("MAIN_ARC_COMPLETED"));
});

test("a negative response after a positive one resets the streak and regrows the Monster", () => {
  const world = setup();
  world.resolve("a", "b", "POSITIVE");
  world.resolve("a", "c", "NEGATIVE");
  assert.equal(world.get("a").monsterState, FULL);
  assert.equal(world.get("a").positiveStreak, 0);
  assert.equal(world.get("c").monsterState, FULL);
  world.resolve("c", "d", "POSITIVE"); // c is now main; one positive is not enough
  assert.equal(world.get("c").monsterState, SMALL);
});

test("neutral and unclear responses change nothing", () => {
  const world = setup();
  for (const action of ["NEUTRAL", "UNCLEAR", undefined]) world.resolve("a", "b", action);
  assert.equal(world.get("a").monsterState, FULL);
  assert.equal(world.get("b").monsterState, NONE);
  assert.equal(world.mainId, "a");
  assert.equal(world.monsterCount, 1);
});

test("someone with no Monster cannot spawn one", () => {
  const world = setup();
  world.resolve("b", "c", "NEGATIVE");
  assert.equal(world.get("c").monsterState, NONE);
  assert.equal(world.monsterCount, 1);
});

test("a recipient who already has a Monster does not get a second one", () => {
  const world = setup();
  world.resolve("a", "b", "NEGATIVE"); // a -> side, b main
  world.resolve("b", "c", "POSITIVE"); // b SMALL
  world.resolve("a", "b", "NEGATIVE"); // side character a hits b again
  assert.equal(world.get("b").monsterState, FULL);
  assert.equal(world.monsterCount, 2);
  assert.equal(world.mainId, "b");
});

test("side stories use the same rules and count toward the world total", () => {
  const world = setup();
  world.resolve("a", "b", "NEGATIVE");                  // a is now a side story
  const events = types(world.resolve("a", "c", "NEGATIVE"));
  assert.equal(world.get("c").storyMode, AI_SIDE_STORY); // a new side story, main stays with b
  assert.equal(world.mainId, "b");
  assert.equal(world.monsterCount, 3);
  assert.ok(events.includes("SIDE_STORY_CREATED") && events.includes("SIDE_STORY_UPDATED"));
  world.resolve("a", "d", "POSITIVE");
  world.resolve("a", "d", "POSITIVE");
  assert.equal(world.get("a").monsterState, NONE);
  assert.equal(world.monsterCount, 2);
});

// ---------------------------------------------------------------- Episode 01 content
import { EPISODE, SCENARIOS, KID_SCENARIOS, validChoices, scenarioFor, localSideBeat } from "./public/ripple/content.js";

test("every choice moment offers exactly two harsh answers and one kind one", () => {
  for (const scenario of [EPISODE.hallway, ...SCENARIOS, ...KID_SCENARIOS]) {
    assert.ok(validChoices(scenario.choices), `choices for ${scenario.id}`);
    for (const c of scenario.choices) assert.ok(c.beat && c.after, `beat and after for ${scenario.id}`);
  }
  assert.equal(validChoices([{ action: "POSITIVE", label: "a" }, { action: "POSITIVE", label: "b" }, { action: "NEGATIVE", label: "c" }]), false);
});

test("people head to their own places first: Dad to the clinic, Mia to school", () => {
  const world = new World();
  const dad = world.add(EPISODE.dad), mia = world.add(EPISODE.child);
  assert.equal(scenarioFor(dad).id, "clinic");
  assert.equal(scenarioFor(mia).id, "classroom");
  dad.monsterState = FULL;
  for (let i = 0; i < 20; i++) assert.notEqual(localSideBeat(dad).scenario.id, "clinic"); // the clinic is only on Dad's route
  for (let i = 0; i < 20; i++) assert.ok(KID_SCENARIOS.includes(scenarioFor(mia)));
});

import { outcomePrompt, encounterPrompt, exitPrompt, soloPrompt, setCreatures } from "./public/ripple/content.js";

test("every shot describes at most one creature (three only at the dinner table), never as an animal or a count", () => {
  const world = new World();
  const mom = world.add(EPISODE.mom), dad = world.add(EPISODE.dad), mia = world.add(EPISODE.child);
  world.seed(mom.characterId);
  const mentions = (prompt) => (prompt.match(/creature/g) ?? []).length;

  assert.equal(mentions(EPISODE.kitchenPrompt(mom)), 1);                                    // Mom alone with hers
  const harsh = outcomePrompt(mom, dad, "A kitchen", "NEGATIVE", ["MONSTER_SPAWNED"]);
  assert.equal(mentions(harsh), 1);                                                         // the hurt person alone, with the new one
  assert.ok(harsh.includes("stands alone in the frame") && harsh.includes("light blue shirt"));
  world.resolve(mom.characterId, dad.characterId, "NEGATIVE");
  world.resolve(dad.characterId, mia.characterId, "NEGATIVE");
  assert.equal(mentions(encounterPrompt(mia, dad, EPISODE.hallway)), 1);                    // both carry one; only the main character's is described
  assert.equal(mentions(exitPrompt(dad, mia, "A hallway")), 1);
  assert.equal(mentions(soloPrompt(dad)), 1);
  const once = outcomePrompt(dad, mia, "A hallway", "POSITIVE", ["MONSTER_SHRUNK"]);
  assert.equal(mentions(once), 1);
  assert.ok(once.includes("tiny dim dark-purple"));                                         // kind once: small at the end
  assert.equal(mentions(outcomePrompt(dad, mia, "A hallway", "POSITIVE", ["MONSTER_REMOVED"])), 0); // kind twice: none
  assert.equal(mentions(EPISODE.dinnerPrompt(mom, dad, mia)), 3);                           // the one shot that shows everyone's

  const all = [EPISODE.kitchenPrompt(mom), harsh, once, encounterPrompt(dad, mia, EPISODE.hallway), EPISODE.dinnerPrompt(mom, dad, mia)];
  for (const prompt of all) {
    assert.ok(!/\\bcat\\b|kitten|mouse|splits|copy|drifts|exactly|more than one|in total|,,|\\btwo\\b/i.test(prompt), prompt);
  }
  setCreatures(false);
  try { assert.equal(mentions(EPISODE.kitchenPrompt(mom) + harsh.replace(/./g, "") + outcomePrompt(mom, dad, "A kitchen", "NEGATIVE", [])), 0); }
  finally { setCreatures(true); }
});

import { layoutRadial, FANS } from "./public/ripple/layout.js";

test("the graph layout is a radial tree around the main window", () => {
  // hub -> a -> b -> c, a -> d, hub -> e -> f, e -> g, and a loose node z
  const links = [["hub", "a"], ["a", "b"], ["b", "c"], ["a", "d"], ["hub", "e"], ["e", "f"], ["e", "g"]].map(([from, to]) => ({ from, to }));
  const nodes = ["a", "b", "c", "d", "e", "f", "g", "z"];
  const placement = layoutRadial(nodes, links, new Set(["hub"]));
  assert.equal(placement.size, nodes.length);
  const distance = (p) => Math.hypot(p.x, p.y);

  for (const [id, p] of placement) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), id);
    if (p.parent !== null) {
      const parent = placement.get(p.parent);
      assert.equal(p.depth, parent.depth + 1);
      assert.ok(distance(p) > distance(parent), `${id} sits further out than ${p.parent}`);
    } else {
      assert.equal(p.depth, 1);
      assert.ok(FANS.some(([from, to]) => p.angle >= from && p.angle <= to), `${id} sits beside the main window, clear of the count above and the choices below`);
    }
  }
  assert.equal(placement.get("z").loose, true);
  assert.equal(placement.get("b").parent, "a");

  // Ring windows are about 0.48 m wide; no two centres may be closer than that.
  const all = [...placement];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const gap = Math.hypot(all[i][1].x - all[j][1].x, all[i][1].y - all[j][1].y);
    assert.ok(gap > 0.45, `${all[i][0]} and ${all[j][0]} overlap (${gap.toFixed(2)} m apart)`);
  }

  // One branch on its own starts off to the side, not straight above the main window.
  const single = layoutRadial(["a"], [{ from: "hub", to: "a" }], new Set(["hub"])).get("a");
  assert.ok(single.x > 1 && Math.abs(single.y) < 0.6);
});

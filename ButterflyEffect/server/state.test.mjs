// Rules of The Ripple's state manager. Run with `npm test` in server/.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  for (const scenario of [EPISODE.kitchenResponse, EPISODE.hallway, ...SCENARIOS, ...KID_SCENARIOS]) {
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

test("family voices are locked to their exact saved Satie sounds", async () => {
  const manifest = JSON.parse(await readFile(new URL("../prompt/characters.json", import.meta.url), "utf8"));
  assert.equal(manifest.characters.person_mom.voice.savedSoundSlug, "warm-adult-voice");
  assert.equal(manifest.characters.person_dad.voice.savedSoundSlug, "brief-excited-baseball");
  assert.equal(manifest.characters.person_mom.voice.lockedAcrossScenes, true);
  assert.equal(manifest.characters.person_dad.voice.lockedAcrossScenes, true);
  assert.match(manifest.characters.person_mom.emotionalProfile.expression, /furrowed brow/);
});

import { castVoice, inferVoiceClass, quotedSpeech } from "./public/ripple/voice-casting.js";

test("future characters are cast by demographic and keep a stable Satie voice", async () => {
  const manifest = JSON.parse(await readFile(new URL("../prompt/characters.json", import.meta.url), "utf8"));
  const woman = { characterId: "person_aya", name: "Aya", appearanceDescription: "a woman in her thirties", kid: false };
  const man = { characterId: "person_eli", name: "Eli", appearanceDescription: "a man in his forties", kid: false };
  const child = { characterId: "person_zoe", name: "Zoe", appearanceDescription: "a nine-year-old child", kid: true };
  assert.equal(inferVoiceClass(woman), "adult-woman");
  assert.equal(inferVoiceClass(man), "adult-man");
  assert.equal(inferVoiceClass(child), "child");
  assert.equal(castVoice(woman, manifest.voiceCasting).voiceClass, "adult-woman");
  assert.equal(castVoice(man, manifest.voiceCasting).voiceClass, "adult-man");
  assert.equal(castVoice(child, manifest.voiceCasting).voiceClass, "child");
  assert.deepEqual(castVoice(woman, manifest.voiceCasting), castVoice(woman, manifest.voiceCasting));
});

test("dialogue extraction keeps multiple quoted phrases in speaking order", () => {
  assert.equal(quotedSpeech('MIA: “Can you pass it?” MOM: “Here you go.”'), "Can you pass it? Here you go.");
});

import { outcomePrompt, encounterPrompt } from "./public/ripple/content.js";
import { chooseReaction, reactionForResponse, objectAction } from "./public/ripple/reaction-engine.js";

test("bad responses select one of five promptable reactions; good responses do not", async () => {
  const config = JSON.parse(await readFile(new URL("../prompt/interaction-audio.json", import.meta.url), "utf8"));
  const publicConfig = JSON.parse(await readFile(new URL("./public/ripple/interaction-audio.json", import.meta.url), "utf8"));
  assert.deepEqual(publicConfig, config, "public manifest must stay in sync with the authoring manifest");
  assert.equal(config.actions.length, 5);
  assert.equal(chooseReaction(config, () => 0).name, "slap");
  assert.equal(chooseReaction(config, () => 0.999).name, "none");
  const reaction = reactionForResponse(config, "NEGATIVE", { actor: "Dad", reactor: "Mom" }, () => 0);
  assert.equal(reaction.actionId, 1);
  assert.match(reaction.prompt, /Mom/);
  assert.match(reaction.prompt, /Dad/);
  assert.equal(reaction.sound.savedSoundSlug, "hand-clap-8");
  assert.equal(reactionForResponse(config, "POSITIVE", {}, () => 0), null);
  assert.equal(objectAction(config, "dishwasher", "start").event, "object_interaction");
});

test("prompts name exactly one creature per carrier and say nothing about people without one", () => {
  const world = new World();
  const mom = world.add(EPISODE.mom), dad = world.add(EPISODE.dad);
  world.seed(mom.characterId);
  const opening = EPISODE.kitchenPrompt(mom, dad);
  assert.equal(opening.match(/Perched on/g).length, 1);
  assert.ok(opening.includes("exactly one such creature"));
  assert.ok(!/bare|nothing is perched/.test(opening));
  const harsh = outcomePrompt(mom, dad, "A kitchen", "NEGATIVE", ["MONSTER_SPAWNED"]);
  assert.ok(harsh.includes("splits in two") && harsh.includes("each of the two people carries exactly one creature"));
  world.resolve(mom.characterId, dad.characterId, "NEGATIVE");
  assert.ok(encounterPrompt(dad, world.add(EPISODE.child), EPISODE.hallway).includes("exactly one such creature"));
});

test("decision and outcome prompts keep the camera attached to the Monster-carrier", () => {
  const world = new World();
  const dad = world.add(EPISODE.dad), mia = world.add(EPISODE.child);
  world.seed(dad.characterId);
  const decision = encounterPrompt(dad, mia, EPISODE.hallway);
  assert.match(decision, /behind (?:their|the Monster-carrier's) left shoulder/);
  assert.match(decision, /never centered neutrally/);
  const outcome = outcomePrompt(dad, mia, EPISODE.hallway.place, "NEGATIVE", ["MONSTER_SPAWNED"]);
  assert.match(outcome, /carrier remains large in the near foreground/);
  assert.match(outcome, /rack focus to the other person's reaction/);
});

test("Mom's opening makes contemplation readable before her first choice", () => {
  const world = new World();
  const mom = world.add(EPISODE.mom), dad = world.add(EPISODE.dad);
  world.seed(mom.characterId);
  const opening = EPISODE.kitchenPrompt(mom, dad);
  assert.match(opening, /Extreme close-up on Mom after the creature forms/);
  assert.match(opening, /freeze mid-task and hold a small breath/);
  assert.match(opening, /No speaking before the choice/);
  assert.match(EPISODE.kitchenResponse.caption, /^\{A\} finds the dishwasher/);
  assert.ok(EPISODE.kitchenResponse.choices.every((entry) => /turn|face|stare|eye contact/.test(entry.beat)));
});

test("response direction preserves eyelines and shows that anger brings no relief", () => {
  const world = new World();
  const mom = world.add(EPISODE.mom), dad = world.add(EPISODE.dad);
  world.seed(mom.characterId);
  const harsh = outcomePrompt(mom, dad, EPISODE.kitchenPlace, "NEGATIVE", ["MONSTER_SPAWNED"], EPISODE.kitchenResponse.choices[0].beat);
  assert.match(harsh, /anger brings no relief/);
  assert.match(harsh, /turn the face and upper body toward the other person/);
  assert.match(harsh, /only exception is an explicitly avoidant action/);
});

// The Ripple: deterministic Story State Manager.
// The AI (voice interpreter, side-story director) only proposes actions. Every Monster
// change goes through World.resolve(), so the video model is never the source of truth.
// Pure module: runs in the browser and under `node --test`.

export const FULL = "FULL";
export const SMALL = "SMALL";
export const NONE = "NONE";

export const PLAYER_MAIN = "PLAYER_MAIN";
export const AI_SIDE_STORY = "AI_SIDE_STORY";
export const OFFSCREEN = "OFFSCREEN"; // met, has state, has no window
export const ARC_COMPLETE = "ARC_COMPLETE";

export class World {
  constructor() {
    this.characters = new Map();
    this.mainId = null;
    this.log = [];
    this.listeners = new Set();
  }

  add(def) {
    const character = {
      characterId: def.characterId,
      name: def.name,
      identityReference: def.characterId,
      appearanceDescription: def.appearanceDescription,
      personality: def.personality ?? "",
      kid: Boolean(def.kid),
      role: def.role ?? "",                           // mom, dad or child for the family
      routine: def.routine ? [...def.routine] : [],   // places this person is headed first
      voiceProfile: def.voiceProfile ?? "",
      currentEmotion: "calm",
      monsterState: NONE,
      positiveStreak: 0,
      currentLocation: "",
      relationships: [],
      storyMemory: [],
      storyMode: OFFSCREEN,
      activeWindowId: null,
    };
    this.characters.set(character.characterId, character);
    return character;
  }

  get(id) { return this.characters.get(id); }
  get main() { return this.mainId ? this.get(this.mainId) : null; }
  list() { return [...this.characters.values()]; }

  /** Characters with an active Monster. FULL and SMALL both count as one. */
  get monsterCount() { return this.list().filter((c) => c.monsterState !== NONE).length; }

  on(listener) { this.listeners.add(listener); }

  emit(type, data = {}) {
    const event = { type, ...data };
    this.log.push(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  worldUpdated() { return this.emit("WORLD_STATE_UPDATED", { monsterCount: this.monsterCount }); }

  /** Opening state only: the first character starts the story already carrying a Monster. */
  seed(id) {
    const c = this.get(id);
    c.monsterState = FULL;
    c.currentEmotion = "frustrated";
    c.storyMode = PLAYER_MAIN;
    this.mainId = id;
    return [this.emit("MONSTER_SPAWNED", { characterId: id }), this.worldUpdated()];
  }

  /** A side-story carrier steps into the Main Story Window after the previous arc ended. */
  promote(id) {
    if (this.mainId) throw new Error("main story is still active");
    this.get(id).storyMode = PLAYER_MAIN;
    this.mainId = id;
    return [this.emit("MAIN_CHARACTER_CHANGED", { characterId: id, from: null })];
  }

  /**
   * Applies one interaction. action is POSITIVE, NEGATIVE or NEUTRAL.
   * Returns the events it produced, in order.
   */
  resolve(actorId, recipientId, action, summary = "") {
    const actor = this.get(actorId);
    const recipient = this.get(recipientId);
    if (!actor || !recipient || actor === recipient) throw new Error("unknown actor or recipient");
    const events = [];
    const push = (type, data) => events.push(this.emit(type, data));

    // Only someone carrying a Monster can pass it on or work it off. Silence and
    // unclear replies arrive here as NEUTRAL and change nothing.
    if (actor.monsterState === NONE || (action !== "POSITIVE" && action !== "NEGATIVE")) {
      push("ACTION_RESOLVED", { actorId, recipientId, action: "NEUTRAL" });
      events.push(this.worldUpdated());
      return events;
    }

    push("ACTION_RESOLVED", { actorId, recipientId, action });
    actor.storyMemory.push({ role: "actor", with: recipientId, action, summary });
    recipient.storyMemory.push({ role: "recipient", with: actorId, action, summary });
    if (!actor.relationships.includes(recipientId)) actor.relationships.push(recipientId);
    if (!recipient.relationships.includes(actorId)) recipient.relationships.push(actorId);

    if (action === "NEGATIVE") {
      actor.positiveStreak = 0;
      actor.currentEmotion = "angry";
      if (actor.monsterState === SMALL) {
        actor.monsterState = FULL;
        push("MONSTER_REGROWN", { characterId: actorId });
      }
      // Monsters spawn, they do not transfer: the actor keeps theirs.
      recipient.positiveStreak = 0;
      recipient.currentEmotion = "hurt";
      if (recipient.monsterState === NONE) {
        recipient.monsterState = FULL;
        push("MONSTER_SPAWNED", { characterId: recipientId, from: actorId });
      } else if (recipient.monsterState === SMALL) {
        // Already affected: no second Monster, but theirs is back to full strength.
        recipient.monsterState = FULL;
        push("MONSTER_REGROWN", { characterId: recipientId });
      }

      if (actor.storyMode === PLAYER_MAIN) {
        actor.storyMode = AI_SIDE_STORY;
        recipient.storyMode = PLAYER_MAIN;
        this.mainId = recipientId;
        push("SIDE_STORY_CREATED", { characterId: actorId });
        push("MAIN_CHARACTER_CHANGED", { characterId: recipientId, from: actorId });
      } else {
        if (recipient.storyMode === OFFSCREEN || recipient.storyMode === ARC_COMPLETE) {
          recipient.storyMode = AI_SIDE_STORY;
          push("SIDE_STORY_CREATED", { characterId: recipientId });
        }
        push("SIDE_STORY_UPDATED", { characterId: actorId });
      }
    } else {
      actor.positiveStreak += 1;
      if (actor.monsterState === SMALL) {
        actor.monsterState = NONE;
        actor.positiveStreak = 0;
        actor.currentEmotion = "at peace";
        push("MONSTER_REMOVED", { characterId: actorId });
        if (actor.storyMode === PLAYER_MAIN) {
          actor.storyMode = ARC_COMPLETE;
          this.mainId = null;
          push("MAIN_ARC_COMPLETED", { characterId: actorId });
        }
      } else {
        actor.monsterState = SMALL;
        actor.currentEmotion = "calmer";
        push("MONSTER_SHRUNK", { characterId: actorId });
      }
      if (actor.storyMode === AI_SIDE_STORY) push("SIDE_STORY_UPDATED", { characterId: actorId });
    }

    events.push(this.worldUpdated());
    return events;
  }
}

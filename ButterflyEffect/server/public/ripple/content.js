// The Ripple: cast, everyday situations and the prompts sent to Visko.
// A character's appearance text is repeated word for word in every prompt. That is the
// only thing keeping someone recognisable between the main window and a side window.

import { FULL, SMALL } from "./state.js";

export const STYLE =
  "Third-person cinematic camera, both people clearly readable in the same frame, realistic acting, " +
  "subtle facial expressions, naturalistic light, shallow depth of field, muted film palette, photoreal, 35mm film look.";

export const CAST = [
  ["Maya", "a woman in her thirties with short black hair, round glasses and a mustard-yellow raincoat"],
  ["Leo", "a tall young man with curly brown hair, a grey hoodie and a blue backpack"],
  ["Priya", "a woman in her fifties with a long silver braid, a green cardigan and a canvas tote bag"],
  ["Sam", "a stocky man in his forties with a shaved head, a short beard and a red flannel shirt"],
  ["Noor", "a teenager with a pink beanie, an oversized denim jacket and headphones around the neck"],
  ["Tomas", "an elderly man with white hair, a tweed flat cap and a brown wool coat"],
  ["Jin", "a woman in her twenties with a sleek ponytail, a white blouse and a lanyard badge"],
  ["Dale", "a heavyset man in his thirties with a blond buzz cut, an orange safety vest and work boots"],
  ["Aisha", "a woman in her forties with a navy headscarf, a long beige coat and a leather satchel"],
  ["Ben", "a lanky man in his twenties with red hair, a striped scarf and a bicycle helmet"],
  ["Rosa", "a woman in her sixties with curly grey hair, a floral dress and a purple shawl"],
  ["Kofi", "a broad-shouldered man in his thirties with short dreadlocks, a black turtleneck and a camera strap"],
].map(([name, appearanceDescription]) => ({ characterId: "person_" + name.toLowerCase(), name, appearanceDescription }));

// {a} is the person carrying the Monster, {r} is the person they run into.
export const SCENARIOS = [
  { place: "A busy city cafe at lunchtime, warm pendant lights", visual: "{r} turns from the counter and spills a full cup of coffee down the front of {a}", caption: "{R} spills coffee all over {A}." },
  { place: "A crowded city bus in the evening rush, grey window light", visual: "{r} stumbles as the bus brakes and steps hard on the foot of {a}", caption: "{R} stumbles on the bus and stamps on {A}'s foot." },
  { place: "An open-plan office in flat morning light", visual: "{r} holds up a printed report and points out a mistake on it to {a} while colleagues look over", caption: "{R} points out {A}'s mistake in front of the whole team." },
  { place: "A supermarket checkout queue under fluorescent light", visual: "{r} steps into the queue directly in front of {a} with a full basket, not looking back", caption: "{R} cuts into the queue right in front of {A}." },
  { place: "A narrow apartment hallway at night, one warm ceiling lamp", visual: "{r} is stacking moving boxes that completely block the door of {a}", caption: "{R}'s moving boxes are blocking {A}'s front door." },
  { place: "A rainy street corner at dusk, wet pavement reflecting shop lights", visual: "{r} hurries past with an open umbrella that knocks the phone out of the hand of {a}", caption: "{R}'s umbrella knocks {A}'s phone into a puddle." },
  { place: "A city park in low afternoon sun", visual: "{r} is pulled along by a muddy dog on a lead that jumps up against {a}, leaving paw prints", caption: "{R}'s muddy dog jumps up on {A}." },
  { place: "An office lobby by the lifts, polished floor, cool daylight", visual: "{r} is already inside the lift and lets the doors slide shut as {a} hurries toward them", caption: "{R} lets the lift doors close in {A}'s face." },
];

export function monsterOn(character) {
  if (character.monsterState === FULL) {
    return "Perched on their left shoulder is a small soot-black creature the size of a cat, with a round body, two glowing ember-red eyes and thin wisps of dark smoke rising from it";
  }
  if (character.monsterState === SMALL) {
    return "Perched on their left shoulder is a tiny soot-black creature no bigger than a mouse, its two ember-red eyes dim, almost no smoke";
  }
  return "Their shoulders are bare, nothing is perched on them";
}

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const fill = (text, a, r) =>
  text.replaceAll("{a}", a.appearanceDescription).replaceAll("{r}", r.appearanceDescription)
      .replaceAll("{A}", a.name).replaceAll("{R}", r.name);

export const captionFor = (scenario, a, r) => fill(scenario.caption, a, r);

/** A character on their own, between encounters. */
export function soloPrompt(c, mood = "walks alone, jaw tight, shoulders tense, lost in a bad mood") {
  return `A city street in the early evening. ${cap(c.appearanceDescription)} ${mood}. ${monsterOn(c)}. Slow tracking shot from the front and slightly to the side, shoulders and face clearly visible. ${STYLE}`;
}

/** The moment that waits for a reply: the provocation has happened, the actor has not answered yet. */
export function encounterPrompt(a, r, scenario) {
  return `${scenario.place}. ${cap(fill(scenario.visual, a, r))}. ${cap(a.appearanceDescription)} stiffens and turns to face them, jaw tight, about to speak. ${monsterOn(a)}. The other person, ${r.appearanceDescription}, looks back uncertainly. ${monsterOn(r)}. Medium two-shot, steady camera. ${STYLE}`;
}

/** What the camera shows once the state manager has applied the action. `types` are the event types it produced. */
export function outcomePrompt(a, r, place, action, types, beat = "") {
  const A = cap(a.appearanceDescription);
  const R = r.appearanceDescription;
  let body;
  if (action === "NEGATIVE") {
    const spawn = types.includes("MONSTER_SPAWNED")
      ? "On the left shoulder of the person who was snapped at, a new small soot-black creature pushes up out of nothing and swells to the size of a cat, opening two glowing ember-red eyes"
      : "The soot-black creature already on the other person's left shoulder swells and its ember-red eyes flare";
    body = `${A} ${beat || "snaps harshly, face hard, one hand thrown up"}, speaking to ${R}, who flinches and then tightens with hurt and anger. The cat-sized soot-black creature on the first person's left shoulder stays exactly where it is, its ember-red eyes burning brighter. ${spawn}. Now both people carry a creature on their shoulder`;
  } else if (action === "POSITIVE" && types.includes("MONSTER_REMOVED")) {
    body = `${A} ${beat || "smiles tiredly and speaks gently"}, speaking to ${R}, who relaxes and smiles back. The tiny soot-black creature on the first person's left shoulder loses its shape, unravels into pale drifting smoke and vanishes completely, leaving the shoulder bare. Warm clean light fills the frame`;
  } else if (action === "POSITIVE") {
    body = `${A} ${beat || "breathes out, lets their shoulders drop and speaks calmly"}, speaking to ${R}, who relaxes with visible relief. The soot-black creature on the first person's left shoulder shrinks from the size of a cat to the size of a mouse, its ember-red eyes dimming. The other person's shoulders stay bare`;
  } else {
    body = `${A} says very little and looks away from ${R}, who shrugs and moves on. ${monsterOn(a)}`;
  }
  return `${place}. ${body}. Medium two-shot, steady camera. ${STYLE}`;
}

// Used for side stories when the server has no Claude credentials.
const SIDE_NEGATIVE = ["snaps at them without looking up", "mutters something cutting and turns away", "raises their voice and jabs a finger at them"];
const SIDE_POSITIVE = ["stops, takes a breath and apologises for their tone", "laughs it off and helps them", "admits it has been a rough day and thanks them"];

export function localSideBeat(actor, random = Math.random) {
  const scenario = SCENARIOS[Math.floor(random() * SCENARIOS.length)];
  // Someone who has already softened once is more likely to do it again.
  const action = random() < (actor.monsterState === SMALL ? 0.7 : 0.5) ? "POSITIVE" : "NEGATIVE";
  const beats = action === "POSITIVE" ? SIDE_POSITIVE : SIDE_NEGATIVE;
  return { action, scenario, beat: beats[Math.floor(random() * beats.length)], source: "local" };
}

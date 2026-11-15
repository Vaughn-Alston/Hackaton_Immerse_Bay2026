// The Ripple, Episode 01: The Dishwasher. Cast, situations, choices and the prompts sent to Visko.
//
// A character's appearance text is repeated word for word in every prompt. That is the
// only thing keeping someone recognisable between the main window and a side window.
//
// Every choice moment offers exactly two harsh answers and one kind one. The pull toward the
// harsh ones is in the writing: the character has been wronged, the harsh answers sound like
// things a decent person says on a bad day, and the kind answer says what it costs.

import { FULL, SMALL } from "./state.js";

export const STYLE =
  "Third-person cinematic camera, everyone clearly readable in the same frame, realistic acting, " +
  "subtle facial expressions, naturalistic light, shallow depth of field, photoreal, 35mm film look.";

// One description of the family kitchen, so the morning and the evening are the same room.
const KITCHEN = "A comfortable family kitchen with pale oak cabinets, a white tiled splashback, a stainless-steel dishwasher under the counter and a round wooden dining table by the window";

const person = ([name, appearanceDescription, personality, kid = false, extra = {}]) =>
  ({ characterId: "person_" + name.toLowerCase(), name, appearanceDescription, personality, kid, ...extra });

const N = "NEGATIVE", P = "POSITIVE";
const choice = (action, label, beat, after) => ({ action, label, beat, after });

/** The creature on one person's shoulder, or an empty string. Someone without a Monster is not mentioned at all. */
export function monsterOn(character, whose = "their") {
  if (character.monsterState === FULL) {
    return `Perched on ${whose} left shoulder, beside the neck, is a small dark-purple creature the size of a cat, with a round shadowy body and two faintly glowing violet eyes`;
  }
  if (character.monsterState === SMALL) {
    return `Perched on ${whose} left shoulder is a tiny dark-purple creature no bigger than a mouse, its two violet eyes dim`;
  }
  return "";
}

/** The same, as a sentence that can be dropped into a prompt (empty when there is no Monster). */
const creature = (character, whose) => { const text = monsterOn(character, whose); return text ? ` ${text}.` : ""; };

const NUMBER = ["no", "exactly one", "exactly two", "exactly three"];
/** Tells the video model how many creatures the frame holds, so it does not add or drop one. */
export function creatureCount(count) {
  if (count <= 0) return " There are no creatures of any kind anywhere in the scene, and nothing on anyone's shoulders.";
  if (count === 1) return " There is exactly one such creature in the whole scene, on that one person only. Nobody else has anything on their shoulders.";
  return ` There are ${NUMBER[Math.min(count, 3)]} such creatures in the whole scene, one per person, never two on the same person.`;
}
const carrying = (...people) => people.filter((c) => c.monsterState === FULL || c.monsterState === SMALL).length;

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const fill = (text, a, r) =>
  text.replaceAll("{a}", a.appearanceDescription).replaceAll("{r}", r.appearanceDescription)
      .replaceAll("{A}", a.name).replaceAll("{R}", r.name);

export const captionFor = (scenario, a, r) => fill(scenario.caption, a, r);
export const afterFor = (picked, a, r) => fill(picked.after ?? "", a, r);

// ---------------------------------------------------------------- the family and the fixed scenes

export const EPISODE = {
  mom: person(["Mom", "a woman in her late thirties with shoulder-length auburn hair, a cream knitted cardigan and grey lounge trousers", "organised and exhausted, feels she carries the whole house", false, { role: "mom", routine: ["queue", "cafe"] }]),
  dad: person(["Dad", "a man in his early forties with short dark hair and glasses, a light blue shirt and a navy jacket with a doctor's ID badge", "gentle, avoids conflict, swallows things instead of saying them", false, { role: "dad", routine: ["clinic"] }]),
  child: person(["Mia", "a seven-year-old girl with two brown braids, a yellow cardigan and a red school backpack", "bright and sensitive, takes things to heart", true, { role: "child", routine: ["classroom", "playground"] }]),

  kitchenPlace: `${KITCHEN}, soft cool morning sunlight`,

  /** Scene 1, before the question: the full dishwasher that nobody started. */
  kitchenPrompt(mom, dad) {
    return `${this.kitchenPlace}. ${cap(mom.appearanceDescription)} pulls open the dishwasher and finds it full of dirty dishes from the night before; her shoulders sink, tired and frustrated.${creature(mom, "her")} Behind her, ${dad.appearanceDescription} is getting ready to leave for work, checking his bag.${creature(dad, "his")}${creatureCount(carrying(mom, dad))} Medium-wide two-shot. ${STYLE}`;
  },

  /** Scene 1, the scene breaking up: Dad walks out, and the camera goes with him. */
  dadLeavesPrompt(mom, dad) {
    return `${this.kitchenPlace}. ${cap(dad.appearanceDescription)} picks up his bag, turns away and walks out of the kitchen toward the hallway, hurt and trying not to show it.${creature(dad, "his")} Behind him, out of focus, ${mom.appearanceDescription} stays by the open dishwasher.${creature(mom, "her")}${creatureCount(carrying(mom, dad))} The camera follows him from the front. ${STYLE}`;
  },

  /** Scene 1, after: Mom alone, for her side window. */
  momAlonePrompt(mom) {
    return `${this.kitchenPlace}. ${cap(mom.appearanceDescription)} stands alone at the counter, loading the last dishes with short hard movements, jaw tight.${creature(mom, "her")}${creatureCount(carrying(mom))} Medium shot. ${STYLE}`;
  },

  // Scene 2: the first choice. An innocent thing at the worst moment.
  hallway: {
    id: "hallway",
    innocent: true,
    place: "The front hallway of the same family home, coats on hooks, morning light through the glass of the front door",
    visual: "{r} runs up excitedly, holding out a colourful crayon drawing with both hands to {a}, who is pulling on a jacket and glancing at a watch",
    caption: "{A} is already late for the clinic. {R}: “Daddy! Look what I made! Do you like it?”",
    choices: [
      choice(N, "“Not now! Can't you see I'm busy?”", "snaps without looking at the drawing, yanking the jacket straight", "It is out before he can stop it. For a second it almost feels like relief."),
      choice(N, "“Mm. Nice.” Keep walking. You'll look at it properly tonight.", "gives a flat nod past the drawing and keeps walking toward the door", "He didn't raise his voice. He didn't look, either."),
      choice(P, "Stop. Put the bag down, even though you're late. “You worked really hard on this. Tell me about it.”", "stops, sets the bag down, crouches to eye level and looks closely at the drawing", "It costs him four minutes he doesn't have."),
    ],
  },

  /** Scene 4: the same kitchen that evening, everyone carrying whatever the day left them with. */
  dinnerPrompt(mom, dad, child) {
    return `${KITCHEN}, now in warm intimate evening lamplight, the dishwasher humming quietly with a small green light on. Seated around the round wooden table eating dinner are three people. ${cap(mom.appearanceDescription)}.${creature(mom, "her")} Next to her, ${dad.appearanceDescription}.${creature(dad, "his")} Between them, ${child.appearanceDescription}.${creature(child, "the child's")}${creatureCount(carrying(mom, dad, child))} The child reaches across the table for a glass of water and a parent passes it. Plates of food, quiet ordinary conversation. Wide shot from across the table. ${STYLE}`;
  },
};

/** Someone at home that evening, for the closing windows. */
export function eveningPrompt(c) {
  const company = c.kid ? "talking with a parent about the school day" : "sharing a quiet meal with someone they love";
  return `A modest home dining table in warm evening lamplight. ${cap(c.appearanceDescription)} sits at dinner, ${company}.${creature(c)}${creatureCount(carrying(c))} Medium shot, calm and ordinary. ${STYLE}`;
}

// ---------------------------------------------------------------- everyone else

export const CAST = [
  ["Maya", "a woman in her thirties with short black hair, round glasses and a mustard-yellow raincoat", "quick-witted, impatient when tired"],
  ["Leo", "a tall young man with curly brown hair, a grey hoodie and a blue backpack", "easygoing until he feels disrespected"],
  ["Priya", "a woman in her fifties with a long silver braid, a green cardigan and a canvas tote bag", "warm, worn down by looking after everyone"],
  ["Sam", "a stocky man in his forties with a shaved head, a short beard and a red flannel shirt", "blunt, loyal, slow to apologise"],
  ["Noor", "a teenager with a pink beanie, an oversized denim jacket and headphones around the neck", "guarded, funny once she trusts you"],
  ["Tomas", "an elderly man with white hair, a tweed flat cap and a brown wool coat", "gentle, stubborn about small courtesies"],
  ["Jin", "a woman in her twenties with a sleek ponytail, a white blouse and a lanyard badge", "ambitious, anxious about mistakes"],
  ["Dale", "a heavyset man in his thirties with a blond buzz cut, an orange safety vest and work boots", "tired, proud of doing a hard job well"],
  ["Aisha", "a woman in her forties with a navy headscarf, a long beige coat and a leather satchel", "composed, short on patience for rudeness"],
  ["Ben", "a lanky man in his twenties with red hair, a striped scarf and a bicycle helmet", "cheerful, careless, means well"],
  ["Theo", "a ten-year-old boy with messy blond hair, a green dinosaur T-shirt and a blue backpack", "loud, wants to be liked", true],
  ["Zoe", "a nine-year-old girl with tight black curls, a purple raincoat and star-patterned wellies", "confident, bossy, fiercely fair", true],
  ["Omar", "an eight-year-old boy with short dark hair, round glasses and a striped orange jumper", "shy, careful, easily flustered", true],
  ["Lily", "a ten-year-old girl with a long red ponytail, a denim pinafore and a friendship bracelet", "chatty, competitive", true],
].map(person);

// {a} / {A} is the person carrying the Monster, {r} / {R} is the person they run into.
export const SCENARIOS = [
  { id: "clinic", routineOnly: true, place: "A small clinic consulting room, cool daylight through half-closed blinds", visual: "{r} sits rigid in the patient's chair, jabbing a finger at the wall clock and complaining loudly to {a}", caption: "{R} has waited forty minutes past the appointment and lets {A} have it.",
    choices: [
      choice(N, "“I've been on my feet since seven. You're not my only patient.”", "answers sharply, arms crossed, not sitting down", "It is true. That is what makes it land."),
      choice(N, "Say nothing. Type. Keep it clinical and get them out in four minutes.", "stares at the screen and types, answering in clipped words without looking up", "Efficient. Cold. {R} leaves feeling like a file."),
      choice(P, "Sit down. “You're right, that's a long wait, and I'm sorry. Tell me what's going on.”", "sits down, turns away from the screen and leans in to listen", "The apology isn't owed, exactly. {A} gives it anyway."),
    ] },
  { id: "cafe", place: "A busy city cafe at lunchtime, warm pendant lights", visual: "{r} turns from the counter and spills a full cup of coffee down the front of {a}", caption: "{R} spills a full coffee down {A}'s front.",
    choices: [
      choice(N, "“Are you serious? Watch where you're going!”", "throws both hands up and snaps, loud enough for the queue to hear", "The whole cafe looks over. For a moment it feels deserved."),
      choice(N, "Say nothing. Look at the stain, look at them, and walk out.", "looks down at the stain, gives a long cold stare and turns away", "Not a word. {R} will think about that look all afternoon."),
      choice(P, "Breathe. It's a shirt. “It's okay. It happens. Are you burned?”", "exhales slowly, shakes it off and checks the other person is all right", "The shirt is ruined either way. {A} lets it go."),
    ] },
  { id: "bus", place: "A crowded city bus in the evening rush, grey window light", visual: "{r} stumbles as the bus brakes and steps hard on the foot of {a}", caption: "{R} lurches on the bus and stamps on {A}'s foot.",
    choices: [
      choice(N, "“Ow! Hold on to something, for God's sake.”", "winces and snaps, pulling the foot back", "It hurt. Saying so that way hurt someone else."),
      choice(N, "Sigh loudly and turn your back on them.", "lets out a long pointed sigh and turns away to face the window", "No words needed. The whole bus understood."),
      choice(P, "It hurts, and it was an accident. “No harm done. These drivers, honestly.”", "grimaces, then gives a small wry smile and shifts to make room", "The foot still throbs. The moment passes."),
    ] },
  { id: "office", place: "An open-plan office in flat morning light", visual: "{r} holds up a printed report and points out a mistake on it to {a} while colleagues look over", caption: "{R} points out {A}'s mistake in front of the whole team.",
    choices: [
      choice(N, "“Funny, I don't remember you catching your own mistakes last month.”", "fires back a sarcastic remark with a tight smile", "It lands. A few people laugh. {R} goes red."),
      choice(N, "“Noted.” Then a short, cold email, copying their manager.", "says one flat word, turns to the keyboard and types fast", "Perfectly professional. Perfectly cutting."),
      choice(P, "It stings, in front of everyone. “Good catch. Rough night. Thank you.”", "breathes in, nods and takes the report with a tired half-smile", "Admitting it in front of the team is the hard part."),
    ] },
  { id: "queue", place: "A supermarket checkout queue under fluorescent light", visual: "{r} steps into the queue directly in front of {a} with a full basket, not looking back", caption: "{R} cuts into the queue right in front of {A}.",
    choices: [
      choice(N, "“Excuse me? There's a line. We're all waiting.”", "calls it out loudly, pointing back along the queue", "{A} is right. Everyone hears exactly how right."),
      choice(N, "Mutter “unbelievable” just loud enough for them to hear.", "mutters under their breath and shakes their head slowly", "Quiet enough to deny. Loud enough to sting."),
      choice(P, "You're in a hurry too. “I think the line starts back there. No problem, go ahead.”", "points it out gently, then waves them ahead with a small shrug", "It was unfair. {A} lets it be unfair."),
    ] },
  { id: "boxes", place: "A narrow apartment hallway at night, one warm ceiling lamp", visual: "{r} is stacking moving boxes that completely block the door of {a}", caption: "{R}'s moving boxes are blocking {A}'s front door.",
    choices: [
      choice(N, "“Some of us live here. Move them. Now.”", "points at the boxes and barks an order", "A fine welcome to the building."),
      choice(N, "Shove a box aside with your foot and squeeze past without a word.", "kicks one box out of the way and pushes past, not looking at them", "Something inside the box clinks."),
      choice(P, "You're tired. So are they. “Moving day? Here, I'll take that end.”", "puts the bag down and lifts one end of a box with them", "It adds ten minutes to a long day."),
    ] },
  { id: "umbrella", place: "A rainy street corner at dusk, wet pavement reflecting shop lights", visual: "{r} hurries past with an open umbrella that knocks the phone out of the hand of {a}", caption: "{R}'s umbrella knocks {A}'s phone into a puddle.",
    choices: [
      choice(N, "“Hey! You just broke my phone. Look up for once!”", "shouts after them, holding the dripping phone up", "{R} stops dead in the rain."),
      choice(N, "Pick it up, wipe it, and say “Don't bother” when they try to apologise.", "wipes the phone on a sleeve and waves the apology away coldly", "The apology dies in {R}'s mouth."),
      choice(P, "It's wet, not broken. Probably. “It's fine. It's survived worse.”", "checks the phone, breathes out and gives a small rueful smile", "{A} decides not to find out who was at fault."),
    ] },
  { id: "dog", place: "A city park in low afternoon sun", visual: "{r} is pulled along by a muddy dog on a lead that jumps up against {a}, leaving paw prints", caption: "{R}'s muddy dog jumps up on {A}.",
    choices: [
      choice(N, "“Control your dog! These are clean clothes.”", "steps back sharply, brushing at the mud and snapping", "The dog cowers. So does {R}."),
      choice(N, "“If you can't handle it, don't have one.”", "says it flatly while wiping at the paw prints", "Said calmly. That's what makes it stick."),
      choice(P, "It's mud. It washes. “Somebody's happy to see me. What's their name?”", "laughs it off and crouches to greet the dog", "The trousers will need washing tonight."),
    ] },
  { id: "lift", place: "An office lobby by the lifts, polished floor, cool daylight", visual: "{r} is already inside the lift and lets the doors slide shut as {a} hurries toward them", caption: "{R} lets the lift doors close in {A}'s face, then they reopen.",
    choices: [
      choice(N, "“Thanks for holding it.”", "steps in with a sarcastic remark and a hard look", "Eleven floors of silence follow."),
      choice(N, "Step in, stand in front of them, and say nothing the whole way up.", "steps in, turns their back and stares at the doors", "The quiet does the work."),
      choice(P, "Maybe they didn't see. “Close one. Which floor are you?”", "steps in, shakes it off and offers to press the button", "{A} chooses to believe it was an accident."),
    ] },
];

export const KID_SCENARIOS = [
  { id: "classroom", place: "A bright primary school classroom, daylight through tall windows", visual: "{r} leans across the desk and scribbles over the drawing of {a}", caption: "{R} scribbles on {A}'s drawing.",
    choices: [
      choice(N, "“You ruined it! I hate you!”", "shouts and snatches the paper away", "The whole table goes quiet."),
      choice(N, "Scribble on theirs. Harder.", "grabs a crayon and scribbles hard across the other child's paper", "Now there are two ruined drawings."),
      choice(P, "It's ruined and it isn't fair. “That was mine. I worked on it. Please don't.”", "takes a shaky breath and says it firmly without shouting", "It is much harder than shouting."),
    ] },
  { id: "playground", place: "A school playground at morning break, low sun", visual: "{r} runs past and knocks the lunchbox out of the hands of {a}, spilling it across the tarmac", caption: "{R} knocks {A}'s lunchbox across the playground.",
    choices: [
      choice(N, "“Look what you did! You're so clumsy!”", "yells and points at the spilled lunch", "Other children turn to look."),
      choice(N, "Push them. They started it.", "shoves the other child back with both hands", "It felt fair for about one second."),
      choice(P, "Your sandwich is on the ground. “It was an accident, right? Can you help me pick it up?”", "swallows hard, kneels and starts picking things up", "The sandwich is still ruined."),
    ] },
  { id: "lunchline", place: "A noisy school canteen at lunchtime", visual: "{r} pushes into the lunch line directly in front of {a}", caption: "{R} pushes in front of {A} in the lunch line.",
    choices: [
      choice(N, "“No cutting! I'm telling!”", "shouts and points, calling for a teacher", "Everyone in the line stares at {R}."),
      choice(N, "Push in front of them again, and elbow a little.", "squeezes back in front with an elbow", "The line turns into shoving."),
      choice(P, "You were first and you know it. “I was here. But you can go, you look really hungry.”", "says it plainly, then steps back half a pace", "{A} gets lunch one person later."),
    ] },
  { id: "schoolbus", place: "A yellow school bus in the afternoon, sun through dusty windows", visual: "{r} drops into the window seat just as {a} was about to sit there", caption: "{R} takes the seat {A} was about to sit in.",
    choices: [
      choice(N, "“That's MY seat. Move!”", "stands over them and shouts", "{R} shrinks against the window."),
      choice(N, "Sit behind them and kick the back of the seat the whole way home.", "drops into the seat behind and kicks the seat in front", "Thud. Thud. Thud."),
      choice(P, "You wanted the window. “Can I sit next to you? I wanted the window too.”", "hesitates, then sits down beside them", "{A} looks at the aisle all the way home."),
    ] },
  { id: "library", place: "A quiet school library corner with low shelves", visual: "{r} points and laughs after {a} stumbles over a word while reading aloud", caption: "{R} laughs when {A} trips over a word reading aloud.",
    choices: [
      choice(N, "“At least I'm not stupid like you!”", "slams the book shut and shouts back", "{R} stops laughing."),
      choice(N, "Laugh at them later, in front of everyone, when they get one wrong.", "goes red, says nothing and glares, waiting", "{A} waits all afternoon for the chance. It comes."),
      choice(P, "Your face is burning. “That word is hard. Can you say it?”", "takes a breath, face red, and asks quietly", "Turns out {R} can't say it either."),
    ] },
];

const pick = (list, random = Math.random) => list[Math.floor(random() * list.length)];

/** An everyday situation that fits this character's world: school for children, the city for adults. */
export function scenarioFor(actor, random = Math.random) {
  const next = actor.routine?.shift(); // places this person is headed first, e.g. Dad's clinic
  const all = actor.kid ? KID_SCENARIOS : SCENARIOS;
  return all.find((s) => s.id === next) ?? pick(all.filter((s) => !s.routineOnly), random);
}

/** A set of choices is playable only with exactly two harsh answers and one kind one. */
export function validChoices(choices) {
  return Array.isArray(choices) && choices.length === 3
    && choices.every((c) => c && typeof c.label === "string" && c.label)
    && choices.filter((c) => c.action === N).length === 2
    && choices.filter((c) => c.action === P).length === 1;
}

// ---------------------------------------------------------------- prompts

/** A character on their own, between encounters. */
export function soloPrompt(c, mood = "walks alone, jaw tight, shoulders tense, lost in a bad mood") {
  return `A city street in daylight. ${cap(c.appearanceDescription)} ${mood}.${creature(c)}${creatureCount(carrying(c))} Slow tracking shot from the front and slightly to the side, shoulders and face clearly visible. ${STYLE}`;
}

/** The one who was harsh walks out of the scene; the camera stays with the person left behind. */
export function exitPrompt(leaver, stayer, place) {
  return `${place}. ${cap(leaver.appearanceDescription)} turns away and walks out of frame without looking back.${creature(leaver)} The camera stays on ${stayer.appearanceDescription}, left standing there, watching them go.${creature(stayer)}${creatureCount(carrying(leaver, stayer))} Medium shot, steady camera. ${STYLE}`;
}

/**
 * The moment that waits for a choice. The shot builds the pressure first: the thing has just
 * happened, the character tightens, and the creature leans in toward their ear.
 */
export function encounterPrompt(a, r, scenario) {
  const pressure = monsterOn(a) ? ` ${monsterOn(a)}, leaning in close to their ear as if whispering.` : "";
  const other = scenario.innocent ? "looks up at them hopefully, waiting for an answer" : "looks back, unsure what is coming";
  return `${scenario.place}. ${cap(fill(scenario.visual, a, r))}. ${cap(a.appearanceDescription)} stops, jaw tightening, a long tired breath, about to answer.${pressure} The other person, ${r.appearanceDescription}, ${other}.${creature(r)}${creatureCount(carrying(a, r))} Medium two-shot, steady camera. ${STYLE}`;
}

/**
 * What the camera shows as the rules take effect. `types` are the event types the state manager
 * produced (or will produce). A harsh answer makes the creature duplicate: the original stays,
 * and the copy grows on the other person.
 */
export function outcomePrompt(a, r, place, action, types, beat = "") {
  const A = cap(a.appearanceDescription);
  const R = r.appearanceDescription;
  const otherHas = r.monsterState === FULL || r.monsterState === SMALL;
  let body, count;
  if (action === N) {
    const spread = types.includes("MONSTER_SPAWNED")
      ? "The dark-purple creature on the first person's left shoulder splits in two: the original stays exactly where it is, and its copy, a small purple shadow, drifts across to the other person, settles on their left shoulder beside the neck and grows to the size of a cat, opening two violet eyes"
      : "The dark-purple creature on the first person's left shoulder stays exactly where it is, and the smaller creature already on the other person's left shoulder swells back to the size of a cat";
    body = `${A} ${beat || "snaps harshly, face hard"}, speaking to ${R}, whose face falls, hurt and trying not to show it. ${spread}. By the end each of the two people carries exactly one creature`;
    count = 2;
  } else if (action === P && types.includes("MONSTER_REMOVED")) {
    body = `${A} ${beat || "smiles tiredly and speaks gently"}, speaking to ${R}, who relaxes and smiles back. The tiny dark-purple creature on the first person's left shoulder loses its shape, thins into pale drifting mist and vanishes completely. Warm clean light fills the frame`;
    count = otherHas ? 1 : 0;
  } else if (action === P) {
    body = `${A} ${beat || "breathes out, lets their shoulders drop and speaks calmly"}, speaking to ${R}, who brightens with visible relief. The dark-purple creature on the first person's left shoulder shrinks from the size of a cat to the size of a mouse, its violet eyes dimming`;
    count = otherHas ? 2 : 1;
  } else {
    body = `${A} says very little and looks away from ${R}, who shrugs and moves on.${creature(a)}`;
    count = carrying(a, r);
  }
  const total = action === N ? "" : creatureCount(count).replace("There is", "At the end there is").replace("There are", "At the end there are");
  return `${place}. ${body}.${total} Medium two-shot, steady camera. ${STYLE}`;
}

/** A side-story beat without the director: a fitting situation and one of its three written answers. */
export function localSideBeat(actor, random = Math.random) {
  const scenario = scenarioFor(actor, random);
  // Anger is the easy path; someone who has already softened once is a little more likely to do it again.
  const kind = random() < (actor.monsterState === SMALL ? 0.6 : 0.4);
  const picked = pick(scenario.choices.filter((c) => c.action === (kind ? P : N)), random);
  return { action: picked.action, scenario, beat: picked.beat, source: "local" };
}

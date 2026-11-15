// The Ripple's Global Story Director. It sees the whole world and proposes story:
// what side characters do next, and the next encounter and choices for the main character.
// It only proposes. The client's state manager (public/ripple/state.js) applies the Monster rules.
//
// Claude is used when ANTHROPIC_API_KEY is set and `npm install` has been run in server/.
// Without it the client uses the written scenarios and choices in public/ripple/content.js.

const CLAUDE_MODEL = process.env.RIPPLE_MODEL || "claude-opus-5-5";

let claude; // { client, zodOutputFormat, z } once loaded, false when unavailable

async function loadClaude() {
  if (claude !== undefined) return claude;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return (claude = false);
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const { z } = await import("zod");
    claude = { client: new Anthropic({ timeout: 25_000, maxRetries: 1 }), zodOutputFormat, z };
  } catch (error) {
    console.log("  Claude SDK not installed (run `npm install` in server/):", error.message);
    claude = false;
  }
  return claude;
}

export const claudeReady = async () => Boolean(await loadClaude());

/** One structured-output request. Returns the parsed object, or null if Claude declined or the reply was unusable. */
async function ask(system, user, shape) {
  const { client, zodOutputFormat, z } = await loadClaude();
  const response = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 6000,
    // If a safety classifier declines, the API retries on a fallback model in the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: user }],
    // The viewer is waiting in a headset: keep thinking short.
    output_config: { effort: "low", format: zodOutputFormat(z.object(shape(z))) },
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content.find((block) => block.type === "text")?.text;
  try { return JSON.parse(text); } catch { return null; }
}

const DIRECTOR_SYSTEM = `You are the Global Story Director of an interactive piece called The Ripple, Episode 01: The Dishwasher. You see the whole world at once: every character, what they look like, who they are, what has happened to them, and who they have met.

The premise. People can carry a small dark-purple Monster on their shoulder: a bad mood picked up from someone who treated them badly. A carrier who is harsh with someone gives that person a new Monster of their own and keeps theirs. A carrier who responds kindly sees their Monster shrink, and a second kind response in a row makes it disappear. A harsh response after a kind one puts the Monster back to full size.

The episode. It is one ordinary day. At 7:30 AM Mom, already tired, snapped at Dad because he had not started the dishwasher, and a Monster grew on his shoulder. Dad is a doctor and spends the day at his clinic. Their daughter Mia spends it at school. Mom has her own day. The ripple does not stay in the family: patients, classmates, colleagues and strangers catch Monsters and carry them home to their own families. You are told the current time; keep every beat consistent with it and with where each person would be at that hour. The day ends at a 6:30 PM dinner that you do not write.

The player chooses for one character in the main story. Everyone else who carries a Monster lives on in a side story that you direct. Characters do not stop existing when the viewer looks away.

You only propose story. A separate rule engine applies the Monster rules, so never describe a Monster appearing, shrinking or vanishing, and never contradict the Monster state you are given.

The emotional truth of this piece is that anger is the natural reaction and spreads easily, and healing is harder. Write to that:
- Every encounter genuinely lands on the carrier: they are tired, late or already hurting, and the other person does something that costs them, even if innocently (a child wanting attention at the worst moment counts).
- In side stories, lean toward harsh responses, roughly three in five, and a little more kindly for someone whose Monster has already shrunk. Kindness should feel earned and specific, never automatic.
- When you write choices for the main character, write exactly two harsh ones and one kind one. The harsh ones must sound like things a decent person says on a bad day: one hot (a snap, a raised voice) and one cold (dismissal, sarcasm, silence, a cutting look). No cartoon cruelty. The kind one must state what it costs: stopping when late, swallowing being right, letting something unfair go. Each label is what the viewer reads on a button, at most 20 words, written from inside the character: spoken lines in quotation marks, actions as short imperatives ("Sit down. “You're right, I'm sorry.”"). Never label a choice as kind or harsh.

Keep one consistent world:
- Continue each life from where it is, using their personality, mood and history. People are not consistent; someone who lashed out may catch themselves next time.
- Prefer bringing back someone who already exists when it makes sense (a colleague, a family member, the person who hurt them) so storylines cross. Introduce a new person when nobody fits. Never use the main-story character or the person they are currently facing. Children meet children and teachers; adults meet adults.
- Small, ordinary, physical situations that read clearly in a few seconds of silent video. No violence beyond a childish shove, nothing cruel to children.

Field notes:
- place: a sentence fragment setting location and light for a video prompt.
- otherId: the id of an existing character to bring back, or an empty string to introduce someone new.
- other: only used when otherId is empty. name is a first name nobody in the world has. appearanceDescription is one clause with age, hair and two distinctive pieces of clothing, like "a woman in her fifties with a long silver braid, a green cardigan and a canvas tote bag". personality is a few words. kid is true for a child. voiceProfile must match the described person exactly: adult-woman, adult-man, child, or adult-neutral when gender is deliberately unspecified.
- beat: one short clause starting with a verb describing what the character visibly does. No names and no quoted speech; the video model knows neither.
- after: one short sentence shown after a choice is made, the honest emotional aftertaste. A harsh choice may include its moment of release. Use the literal tokens {A} for the main character and {R} for the other person if you need to name them.`;

function describeWorld(world, mainId, engagedId) {
  const name = (id) => world.find((c) => c.characterId === id)?.name ?? id;
  return world.map((c) => {
    const role = c.characterId === mainId ? "MAIN STORY (the player chooses for them)" : c.characterId === engagedId ? "facing the main character right now"
      : c.storyMode === "AI_SIDE_STORY" ? "side story" : "met, not on screen";
    const memory = (c.storyMemory ?? []).slice(-5).map((m) =>
      m.role === "actor" ? `was ${m.action === "NEGATIVE" ? "harsh" : "kind"} to ${name(m.with)}` : `was treated ${m.action === "NEGATIVE" ? "harshly" : "kindly"} by ${name(m.with)}`).join("; ");
    const acting = c.emotionalProfile?.performanceDirection ? ` Acting direction: ${c.emotionalProfile.performanceDirection}.` : "";
    const voice = c.voice?.savedSoundSlug ? ` Locked Satie voice: ${c.voice.savedSoundSlug}.` : ` Voice class: ${c.voiceProfile || "adult-neutral"}.`;
    return `- id ${c.characterId}: ${c.name}${c.kid ? " (child)" : ""}${c.role ? ` [family: ${c.role}]` : ""}, ${c.appearanceDescription}. Personality: ${c.personality || "unknown"}. Mood: ${c.currentEmotion}. Monster: ${c.monsterState}. Role now: ${role}. Last seen: ${c.currentLocation || "unknown"}. History: ${memory || "none yet"}.${acting}${voice}`;
  }).join("\n");
}

/**
 * mode "side": choose which side-story carrier acts next and what they do.
 * mode "main": set up the next encounter for the player's character, with its three choices.
 */
export async function direct({ mode = "side", clock = "", world = [], mainId = null, engagedId = null, candidates = [], actorId = null }) {
  if (!(await loadClaude())) return null;
  const overview = `The time is ${clock || "mid-morning"}.\n\nThe world right now:\n${describeWorld(world, mainId, engagedId)}\n\n`;
  const other = (z) => z.object({
    name: z.string(), appearanceDescription: z.string(), personality: z.string(), kid: z.boolean(),
    voiceProfile: z.enum(["adult-woman", "adult-man", "child", "adult-neutral"]),
  });
  const plan = mode === "main"
    ? await ask(
        DIRECTOR_SYSTEM,
        `${overview}Set up the next encounter for the main-story character, id ${actorId}. Stop at the moment before they respond, and write their three choices.\n\nReturn place, otherId/other, and:\n- provocation: one clause starting with a verb, describing what the other person does. Refer to the main character with the literal token {a}, for example "turns from the counter and spills a full cup of coffee down the front of {a}". No names.\n- caption: one short sentence for the viewer, using the literal tokens {R} for the other person and {A} for the main character, for example "{R} spills a full coffee down {A}'s front."\n- choices: exactly three, two with action NEGATIVE and one with action POSITIVE, each with label, beat and after.`,
        (z) => ({
          place: z.string(), otherId: z.string(), other: other(z), provocation: z.string(), caption: z.string(),
          choices: z.array(z.object({ action: z.enum(["POSITIVE", "NEGATIVE"]), label: z.string(), beat: z.string(), after: z.string() })),
        }),
      )
    : await ask(
        DIRECTOR_SYSTEM,
        `${overview}Advance one side story. Choose which of these carriers acts next: ${candidates.join(", ")}. Favour whoever has waited longest or whose story has the most reason to move.\n\nReturn actorId, place, otherId/other, and:\n- action: POSITIVE or NEGATIVE, how the carrier responds to the person they meet.\n- beat: what the carrier visibly does.\n- caption: under 12 words, starting with a verb so it reads after the carrier's name, for example "snaps at a colleague who asked about the report".`,
        (z) => ({ actorId: z.string(), action: z.enum(["POSITIVE", "NEGATIVE"]), place: z.string(), otherId: z.string(), other: other(z), beat: z.string(), caption: z.string() }),
      );
  return plan && { ...plan, source: "claude" };
}

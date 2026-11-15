// The Ripple's AI calls. Everything here only proposes: the client's state manager
// (public/ripple/state.js) decides what happens to Monsters.
//
//   interpret  what did the player's spoken reply mean, in context?
//   direct     what does an AI-controlled side character do next?
//   transcribe speech to text, for browsers without speech recognition (Quest Browser)
//
// Claude is used when ANTHROPIC_API_KEY is set and `npm install` has been run in server/.
// Without it, interpret falls back to a keyword check and the client scripts side stories.

const CLAUDE_MODEL = process.env.RIPPLE_MODEL || "claude-opus-5-5";
const STT_URL = process.env.STT_URL || "https://api.openai.com/v1/audio/transcriptions";
const STT_MODEL = process.env.STT_MODEL || "whisper-1";

let claude; // { client, zodOutputFormat, z } once loaded, false when unavailable

async function loadClaude() {
  if (claude !== undefined) return claude;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return (claude = false);
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const { z } = await import("zod");
    claude = { client: new Anthropic({ timeout: 20_000, maxRetries: 1 }), zodOutputFormat, z };
  } catch (error) {
    console.log("  Claude SDK not installed (run `npm install` in server/):", error.message);
    claude = false;
  }
  return claude;
}

export const claudeReady = async () => Boolean(await loadClaude());
export const sttReady = () => Boolean(process.env.STT_API_KEY);

/** One structured-output request. Returns the parsed object, or null if Claude declined or the reply was unusable. */
async function ask(system, user, shape) {
  const { client, zodOutputFormat, z } = await loadClaude();
  const response = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    // If a safety classifier declines, the API retries on a fallback model in the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: user }],
    // The player is waiting in a headset: keep thinking short.
    output_config: { effort: "low", format: zodOutputFormat(z.object(shape(z))) },
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content.find((block) => block.type === "text")?.text;
  try { return JSON.parse(text); } catch { return null; }
}

const INTERPRET_SYSTEM = `You judge one spoken reply in an interactive story called The Ripple.

In this story, people carry a small Monster on their shoulder that stands for a bad mood they picked up from someone else. The player speaks for one character (the actor) at the moment another person has just annoyed or wronged them. Your job is to decide whether the reply passes the bad mood on.

Judge what the reply means in this situation, not which words it contains. "Are you kidding me, watch it!" is NEGATIVE. "Honestly I'm having an awful morning, could you help me clean this up?" is POSITIVE, because being honest about a hard day without attacking the other person is constructive. Sarcasm that belittles is NEGATIVE even if the words are polite. Firmly but respectfully asking for something is POSITIVE.

The transcript comes from speech recognition and may be imperfect. Use UNCLEAR when it is empty, garbled, off-topic, or so neutral that you cannot tell whether it would hurt or help the other person. Do not guess: UNCLEAR costs the player nothing, they simply get asked again.

Return:
- action: POSITIVE, NEGATIVE or UNCLEAR
- beat: one short clause for a video prompt describing what the actor visibly does and how they say it, starting with a verb, with no names and no quoted speech (for example "sighs, manages a tired smile and waves it off"). Empty string when UNCLEAR.
- reason: one short sentence for the developers' log.`;

const NEGATIVE_WORDS = /\b(idiot|stupid|moron|useless|shut up|what'?s wrong with you|watch (it|where)|are you (blind|kidding|serious)|your fault|hate|get lost|out of my way|damn|hell|pathetic|clumsy|how dare)\b/i;
const POSITIVE_WORDS = /\b(it'?s (ok|okay|fine|alright|all right)|no (worries|problem|rush|harm)|don'?t worry|accidents? happen|happens|sorry|thank|please|help|rough (day|morning|night)|take your time|my fault|never ?mind|are you (ok|okay|alright))\b/i;

/** Keyword stand-in used only when Claude is not configured. Deliberately cautious: unsure means UNCLEAR. */
function interpretByKeywords(transcript) {
  const negative = NEGATIVE_WORDS.test(transcript);
  const positive = POSITIVE_WORDS.test(transcript);
  const action = negative ? "NEGATIVE" : positive ? "POSITIVE" : "UNCLEAR";
  return { action, beat: "", reason: "keyword fallback", source: "keywords" };
}

export async function interpret({ transcript = "", situation = "", actor = {}, recipient = {} }) {
  transcript = String(transcript).trim();
  if (!transcript) return { action: "UNCLEAR", beat: "", reason: "silence", source: "empty" };
  if (await loadClaude()) {
    try {
      const verdict = await ask(
        INTERPRET_SYSTEM,
        `Situation: ${situation}\nActor: ${actor.name}, ${actor.appearanceDescription}. Current mood: ${actor.currentEmotion}.\nOther person: ${recipient.name}, ${recipient.appearanceDescription}.\n\nWhat the player said, speaking as ${actor.name}:\n"${transcript}"`,
        (z) => ({ action: z.enum(["POSITIVE", "NEGATIVE", "UNCLEAR"]), beat: z.string(), reason: z.string() }),
      );
      if (verdict) return { ...verdict, source: "claude" };
    } catch (error) { console.error("interpret: Claude call failed, using keywords:", error.message); }
  }
  return interpretByKeywords(transcript);
}

const DIRECT_SYSTEM = `You are the Story Director for the side stories of an interactive piece called The Ripple.

People in this world can carry a small Monster on their shoulder: a bad mood picked up from someone who treated them badly. A carrier who is unkind to someone gives that person a new Monster of their own and keeps theirs. A carrier who responds kindly sees their Monster shrink, and a second kind response in a row makes it disappear.

You are given one carrier who has left the player's view and now lives their own life. Invent their next small everyday encounter with one other person, and decide how the carrier responds. Make the choice the one this person would plausibly make given their mood and what has happened to them so far. People are not consistent: someone who lashed out earlier may catch themselves the next time, and someone whose Monster has already shrunk is leaning toward kindness. Across many beats, roughly half should be kind, so the world neither clears itself nor drowns.

You only propose the beat. A separate rule engine decides what happens to the Monsters, so do not describe Monsters appearing, shrinking or vanishing.

Return:
- action: POSITIVE or NEGATIVE (how the carrier responds)
- place: one sentence fragment setting the location and light for a video prompt
- beat: one short clause describing what the carrier visibly does, starting with a verb, no names, no quoted speech
- other: the person they meet. name is a first name not in the list of names already used. appearanceDescription is one clause giving age, hair and two distinctive pieces of clothing, in the form "a woman in her fifties with a long silver braid, a green cardigan and a canvas tote bag".
- caption: under 12 words, what happened, starting with a verb so it reads after the carrier's name (for example "snaps at a bus driver who was running late").`;

export async function direct({ actor = {}, knownNames = [], monsterCount = 0 }) {
  if (!(await loadClaude())) return null;
  const memory = (actor.storyMemory ?? []).slice(-6)
    .map((m) => `- ${m.role === "actor" ? "responded" : "was treated"} ${m.action.toLowerCase()}${m.summary ? ` (${m.summary})` : ""}`).join("\n");
  const beat = await ask(
    DIRECT_SYSTEM,
    `Carrier: ${actor.name}, ${actor.appearanceDescription}.\nMood: ${actor.currentEmotion}. Monster: ${actor.monsterState === "SMALL" ? "already shrunk once" : "full size"}.\nWhat has happened to them so far:\n${memory || "- nothing yet"}\nNames already used: ${knownNames.join(", ")}.\nMonsters in the world right now: ${monsterCount}.`,
    (z) => ({
      action: z.enum(["POSITIVE", "NEGATIVE"]),
      place: z.string(),
      beat: z.string(),
      other: z.object({ name: z.string(), appearanceDescription: z.string() }),
      caption: z.string(),
    }),
  );
  return beat && { ...beat, source: "claude" };
}

/** Sends recorded speech to an OpenAI-compatible transcription endpoint (STT_URL, STT_API_KEY, STT_MODEL). */
export async function transcribe(audio, contentType) {
  const extension = contentType.includes("mp4") ? "mp4" : contentType.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new Blob([audio], { type: contentType }), `speech.${extension}`);
  form.append("model", STT_MODEL);
  form.append("language", "en");
  const reply = await fetch(STT_URL, { method: "POST", headers: { Authorization: `Bearer ${process.env.STT_API_KEY}` }, body: form });
  const text = await reply.text();
  if (!reply.ok) throw new Error(`Transcription service refused the audio (${reply.status}): ${text.slice(0, 200)}`);
  return JSON.parse(text).text ?? "";
}

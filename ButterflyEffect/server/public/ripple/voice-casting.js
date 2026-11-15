// Deterministic character casting. Pure module: safe in the browser and node --test.

export const VOICE_CLASSES = ["adult-woman", "adult-man", "child", "adult-neutral"];

export function inferVoiceClass(character = {}) {
  if (VOICE_CLASSES.includes(character.voiceProfile)) return character.voiceProfile;
  if (character.kid) return "child";
  const words = `${character.name ?? ""} ${character.appearanceDescription ?? ""}`.toLowerCase();
  if (/\b(woman|female|mother|mom|girl)\b/.test(words)) return "adult-woman";
  if (/\b(man|male|father|dad|boy)\b/.test(words)) return "adult-man";
  return "adult-neutral";
}

export function stableHash(value = "") {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Explicit character voices win. Everyone else is cast once from a demographic pool. */
export function castVoice(character, casting = {}) {
  if (character?.voice?.savedSoundSlug && character.voice.assetUrl) {
    return { ...character.voice, voiceClass: character.voice.voiceClass ?? inferVoiceClass(character), playbackRate: 1 };
  }
  const voiceClass = inferVoiceClass(character);
  const pools = casting.pools ?? {};
  const pool = pools[voiceClass]?.length ? pools[voiceClass]
    : voiceClass === "adult-neutral" ? [...(pools["adult-woman"] ?? []), ...(pools["adult-man"] ?? [])]
      : pools["adult-neutral"] ?? [];
  if (!pool.length) return null;
  const hash = stableHash(character.characterId ?? character.name);
  const selected = pool[hash % pool.length];
  // A small deterministic variation helps a finite voice bank keep identities distinct.
  const playbackRate = 0.95 + ((hash >>> 8) % 11) / 100;
  return { ...selected, provider: "satie", voiceClass, lockedAcrossScenes: true, playbackRate };
}

export function quotedSpeech(text = "") {
  return [...String(text).matchAll(/[“\"]([^”\"]+)[”\"]/g)].map((match) => match[1].trim()).filter(Boolean).join(" ");
}

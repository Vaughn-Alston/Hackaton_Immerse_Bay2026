"use client";

import { useEffect, useState } from "react";
import {
  useViskoOrbisStable,
  useViskoState,
  sendSetPrompt,
  sendStart,
  type StateMessage,
} from "../lib/visko";
import {
  buildInitialPrompt,
  getDefaultPerspective,
  setPromptStoryContext,
} from "../lib/prompt-builder";
import {
  beginHumanInteractionTest,
  clearHumanInteractionTest,
} from "../lib/world-state";
// Setup-phase panel. Lets the user write their own prompt and kicks off
// generation with `set_prompt` → `start`. Curated T2V presets were removed
// per launch direction — the example leads image-anchored; free-form text
// (below) works identically and keeps the morph/steer surface live.
//
// Unlike Lingbot, Visko Orbis Stable can start from TEXT ALONE
// (pure text-to-video). An image (set via <ImageStarter>) is optional
// conditioning — if present it anchors the first chunk; if absent the
// model invents the opening frame from the prompt.
//
// Renders null once generation has started — the surface switches to
// <NowPlaying> + <EvolveScene> (live steering) from there.
export function PromptComposer() {
  const s = useViskoOrbisStable();
  const status = s.status;
  const [text, setText] = useState("");
  const [snapshot, setSnapshot] = useState<StateMessage | null>(null);

  useViskoState((msg: StateMessage) => setSnapshot(msg));

  useEffect(() => {
    if (status !== "ready") setSnapshot(null);
  }, [status]);

  // Hide once we're generating — but keep rendering (in disabled form)
  // when the user is just not connected, so the page doesn't go blank
  // after disconnect.
  if (status === "ready" && snapshot?.started) return null;

  const ready = status === "ready";
  const hasImage = snapshot?.has_image === true;


  async function send(prompt: string, preserveInteraction = false) {
    if (!ready || !prompt.trim()) return;
    if (!preserveInteraction) clearHumanInteractionTest();
    await sendSetPrompt(s, buildInitialPrompt(prompt));
    await sendStart(s);
  }

  async function startHumanInteraction() {
    if (!ready) return;
    const interaction = beginHumanInteractionTest();
    setPromptStoryContext(
      interaction.state.currentBeatId,
      interaction.activeCharacterIds,
    );
    try {
      await send(interaction.initialPrompt, true);
    } catch (error) {
      clearHumanInteractionTest();
      throw error;
    }
  }

  const defaultPerspective = getDefaultPerspective();

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <label className="text-[10px] uppercase tracking-wider text-zinc-500">
        Write an opening scene
      </label>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Describe who, their first action, and the world. First-person FOV is added automatically."
        disabled={!ready}
        rows={3}
        className="mt-2 w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 p-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-brand focus:outline-none disabled:opacity-40"
      />

      <p className="mt-1 text-[11px] text-zinc-600">
        Camera: {defaultPerspective.label} (added from perspective data)
      </p>

      <button
        disabled={!ready || !text.trim()}
        onClick={async () => {
          await send(text);
          setText("");
        }}
        className="mt-2 w-full rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-40"
      >
        {hasImage ? "Start from your image" : "Start generating"}
      </button>

      <button
        disabled={!ready}
        onClick={startHumanInteraction}
        className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:border-brand hover:text-brand disabled:opacity-40"
      >
        Start human interaction test
      </button>
      <p className="mt-1 text-[10px] leading-snug text-zinc-600">
        Loads Elias, the forest, relationship context, and allowed actions from
        world data.
      </p>
    </div>
  );
}

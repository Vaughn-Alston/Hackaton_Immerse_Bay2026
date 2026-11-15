"use client";

import { useEffect, useState } from "react";
import {
  useViskoOrbisStable,
  useViskoState,
  sendSetPrompt,
  preferredPrompt,
  type StateMessage,
} from "../lib/visko";
import { findSceneForPrompt } from "../lib/prompts";
import {
  advancePromptStoryBeat,
  buildPerspectiveCorrection,
  buildTransitionPrompt,
  getDefaultPerspective,
} from "../lib/prompt-builder";
import {
  advanceHumanInteraction,
  commitHumanInteractionState,
  createRockState,
  getAvailableHumanActions,
  getHumanInteractionState,
  getRockMaxHealth,
  getWorldTransitionDelayMs,
  hitRock,
  type BreakableObjectState,
  type HumanInteractionState,
} from "../lib/world-state";

// Live-phase panel — the hero surface for this model.
//
// Visko Orbis Stable prompts are PER-CHUNK: calling `set_prompt`
// mid-run morphs the picture into the new description at the next chunk
// boundary (~1.8 s), with no restart and no cut. This is the capability
// the model is being productized around, so it gets the most prominent
// live-phase panel.
//
// We look up which scene the session belongs to by matching the active
// `current_prompt` against our curated library (see `app/lib/prompts.ts`).
// If it matches a known scene's `initial` or any of its `evolutions`,
// we render that scene's evolution list as one-click morphs. Each
// evolution keeps the SAME setting/subject and shifts conditions (time
// of day, weather, light) — continuity is what makes the morph read as
// cinematography instead of a glitch.
//
// If the user typed a custom prompt we don't recognise, the curated
// list disappears — but the user can still steer free-form, so we keep
// a small free-form box at the bottom for that.
export function EvolveScene() {
  const s = useViskoOrbisStable();
  const status = s.status;
  const [snapshot, setSnapshot] = useState<StateMessage | null>(null);
  const [custom, setCustom] = useState("");
  const [rockState, setRockState] =
    useState<BreakableObjectState>(createRockState);
  const [rockCoolingDown, setRockCoolingDown] = useState(false);
  const [interactionState, setInteractionState] =
    useState<HumanInteractionState>(getHumanInteractionState);
  const [interactionCoolingDown, setInteractionCoolingDown] = useState(false);
  // A morph that doesn't visibly land within one chunk boundary can
  // read as "didn't work". Track the in-flight morph: set on click, cleared
  // when the awaited set_prompt resolves — on js-sdk 3.0.0 that resolution
  // IS `prompt_accepted` (the schema's 200 → a correlated reply to this
  // connection only), so it's acknowledged, not just sent. NowPlaying
  // stamps the confirmed chunk alongside.
  //
  // INTENTIONAL SILENCE: there is deliberately NO `on('prompt_accepted')`
  // listener here. On 3.0.0 ack messages are correlated replies, not
  // broadcasts — a listener would compile, subscribe, and never fire.
  // That's 3.0's ack semantics working as designed, not a bug.
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  useViskoState((msg: StateMessage) => setSnapshot(msg));

  useEffect(() => {
    if (status !== "ready") {
      setSnapshot(null);
      setPendingPrompt(null);
    }
  }, [status]);

  useEffect(() => {
    if (!snapshot?.started) setRockState(createRockState());
    if (snapshot?.started) setInteractionState(getHumanInteractionState());
  }, [snapshot?.started]);

  if (status !== "ready" || !snapshot?.started) return null;

  // Match on preferredPrompt() — the user's own words, pinned at send-time
  // in app/lib/visko.ts — never the enhanced rewrite. Passing null because
  // the final 2.3.0 schema dropped `current_prompt` from the state snapshot;
  // the user's own words are the only honest match key, so the evolution
  // chips return mid-run.
  const currentPrompt = preferredPrompt(null);
  const scene = findSceneForPrompt(currentPrompt);
  const pending = pendingPrompt !== null;

  async function sendLivePrompt(prompt: string) {
    const p = prompt.trim();
    if (!p) return;
    setPendingPrompt(p);
    // Awaited set_prompt resolves with `prompt_accepted` (correlated reply
    // on 3.0.0), so by here the model has taken the morph.
    try {
      await sendSetPrompt(s, p);
    } finally {
      setPendingPrompt(null);
    }
  }

  async function steer(action: string) {
    await sendLivePrompt(buildTransitionPrompt(action));
  }

  async function recenterPerspective() {
    await sendLivePrompt(buildPerspectiveCorrection());
  }

  async function punchRock() {
    const result = hitRock(rockState);
    if (result.event === "ignored") return;
    setRockCoolingDown(true);
    try {
      await sendLivePrompt(buildTransitionPrompt(result.prompt));
      setRockState(result.state);
    } finally {
      window.setTimeout(
        () => setRockCoolingDown(false),
        getWorldTransitionDelayMs(),
      );
    }
  }

  async function performHumanAction(actionId: string) {
    const result = advanceHumanInteraction(interactionState, actionId);
    if (result.event === "ignored") return;
    setInteractionCoolingDown(true);
    try {
      await sendLivePrompt(buildTransitionPrompt(result.prompt));
      commitHumanInteractionState(result.state);
      setInteractionState(result.state);
      advancePromptStoryBeat(result.state.currentBeatId);
    } finally {
      window.setTimeout(
        () => setInteractionCoolingDown(false),
        getWorldTransitionDelayMs(),
      );
    }
  }

  const defaultPerspective = getDefaultPerspective();
  const availableHumanActions = getAvailableHumanActions(interactionState);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <label className="text-[10px] uppercase tracking-wider text-zinc-500">
        Steer the scene live
      </label>
      {pending && (
        <p className="mt-2 text-[11px] leading-snug text-brand">
          Morphing… lands at the next chunk boundary (confirmed in Now playing).
        </p>
      )}

      <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-950 p-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium text-zinc-200">
              Perspective: {defaultPerspective.label}
            </p>
            <p className="text-[10px] text-zinc-600">
              Recenter sends only the camera correction.
            </p>
          </div>
          <button
            onClick={recenterPerspective}
            disabled={pending}
            className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-brand hover:text-brand disabled:opacity-40"
          >
            Recenter view
          </button>
        </div>
      </div>

      {interactionState.active && (
        <div className="mt-2 rounded-md border border-brand/40 bg-zinc-950 p-2">
          <p className="text-[11px] font-medium text-zinc-200">
            Human interaction: Elias
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-600">
            Stage: {interactionState.stage} · completed actions:{" "}
            {interactionState.completedActionIds.length}
          </p>

          {availableHumanActions.length > 0 ? (
            <div className="mt-2 grid gap-1.5">
              {availableHumanActions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => performHumanAction(action.id)}
                  disabled={pending || interactionCoolingDown}
                  title={action.prompt}
                  className="rounded-md border border-zinc-700 px-2 py-1.5 text-left text-[11px] text-zinc-200 hover:border-brand hover:text-brand disabled:opacity-40"
                >
                  {interactionCoolingDown
                    ? "Change landing…"
                    : action.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-active">
              Interaction complete. Elias remains in the established scene.
            </p>
          )}
        </div>
      )}

      <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-950 p-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium text-zinc-200">
              Breakable rock test
            </p>
            <p className="text-[10px] text-zinc-600">
              Health {rockState.health}/{getRockMaxHealth()} · hits{" "}
              {rockState.hitCount}/{getRockMaxHealth()}
            </p>
          </div>
          <button
            onClick={punchRock}
            disabled={pending || rockCoolingDown || rockState.destroyed}
            className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-brand hover:text-brand disabled:opacity-40"
          >
            {rockState.destroyed
              ? "Rock broken"
              : rockCoolingDown
                ? "Change landing…"
                : "Punch rock"}
          </button>
        </div>
      </div>

      {scene && (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {scene.evolutions.map((evolution) => {
            const active = currentPrompt === evolution.text;
            return (
              <button
                key={evolution.title}
                onClick={() => steer(evolution.text)}
                disabled={active || pending}
                className={`group rounded-md border p-2 text-left transition-colors ${
                  active
                    ? "border-brand bg-zinc-900"
                    : "border-zinc-800 bg-zinc-950 hover:border-brand disabled:opacity-40"
                }`}
                title={evolution.text}
              >
                <div
                  className={`text-[11px] font-medium ${
                    active
                      ? "text-brand"
                      : "text-zinc-200 group-hover:text-brand"
                  }`}
                >
                  {evolution.title}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-500">
                  {evolution.text}
                </p>
              </button>
            );
          })}
        </div>
      )}

      <textarea
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        placeholder="…or type any new scene and morph to it"
        rows={2}
        className="mt-2 w-full resize-none rounded-md border border-zinc-800 bg-zinc-950 p-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-brand focus:outline-none"
      />
      <button
        disabled={!custom.trim() || pending}
        onClick={async () => {
          await steer(custom);
          setCustom("");
        }}
        className="mt-2 w-full rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Morphing…" : "Morph to this scene"}
      </button>
    </div>
  );
}

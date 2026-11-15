import perspectiveData from "../data/perspectives.json";
import worldData from "../data/world.json";

export type PromptMode = "initial" | "transition" | "correction";

type PerspectiveId = keyof typeof perspectiveData.perspectives;
type Perspective = (typeof perspectiveData.perspectives)[PerspectiveId];

export interface PromptRuntimeState {
  currentPerspectiveId: PerspectiveId;
  lastSentPerspectiveId: PerspectiveId | null;
  currentBeatId: string | null;
  previousBeatId: string | null;
  activeCharacterIds: string[];
  promptMode: PromptMode;
}

const defaultPerspectiveId =
  perspectiveData.defaultPerspectiveId as PerspectiveId;

let runtimeState: PromptRuntimeState = {
  currentPerspectiveId: defaultPerspectiveId,
  lastSentPerspectiveId: null,
  currentBeatId: null,
  previousBeatId: null,
  activeCharacterIds: [],
  promptMode: "initial",
};

function perspectiveFor(id: PerspectiveId): Perspective {
  return perspectiveData.perspectives[id];
}



function cameraPrompt(perspective: Perspective): string {
  const { motion, angle, framing, depthOfField } = perspective.camera;
  return `${motion} camera, ${angle}, ${framing}, ${depthOfField}.`;
}

function canonicalWorldReferences(content: string): string {
  if (!/\brocks?\b/i.test(content)) return "";
  const rock = worldData.objectTypes.breakableRock.visualIdentity;
  return `The rock is ${rock.shape} made of ${rock.material}, with ${rock.surface}.`;
}

export function getPromptRuntimeState(): Readonly<PromptRuntimeState> {
  return runtimeState;
}

export function getDefaultPerspective(): Perspective {
  return perspectiveFor(defaultPerspectiveId);
}

export function setPromptStoryContext(
  currentBeatId: string,
  activeCharacterIds: string[],
): void {
  runtimeState = {
    ...runtimeState,
    currentBeatId,
    previousBeatId: null,
    activeCharacterIds,
  };
}

export function advancePromptStoryBeat(currentBeatId: string): void {
  runtimeState = {
    ...runtimeState,
    previousBeatId: runtimeState.currentBeatId,
    currentBeatId,
  };
}

/** Build the opening prompt. Call once before start(). */
export function buildInitialPrompt(content: string): string {
  const perspective = perspectiveFor(runtimeState.currentPerspectiveId);
  const worldReferences = canonicalWorldReferences(content);
  runtimeState = {
    ...runtimeState,
    lastSentPerspectiveId: runtimeState.currentPerspectiveId,
    promptMode: "initial",
  };

  return [
    content.trim(),
    worldReferences,
    cameraPrompt(perspective),
    "One uninterrupted take.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Build a live steering prompt. Established world and camera are not repeated. */
export function buildTransitionPrompt(action: string): string {
  runtimeState = { ...runtimeState, promptMode: "transition" };
  return action.trim();
}

/** Explicitly animate into a different perspective. */
export function buildPerspectiveTransition(
  perspectiveId: PerspectiveId,
): string {
  const perspective = perspectiveFor(perspectiveId);
  runtimeState = {
    ...runtimeState,
    currentPerspectiveId: perspectiveId,
    lastSentPerspectiveId: perspectiveId,
    promptMode: "transition",
  };
  return perspective.transitionPrompt;
}

/** Repair camera drift without rebuilding the character or world. */
export function buildPerspectiveCorrection(): string {
  const perspective = perspectiveFor(runtimeState.currentPerspectiveId);
  runtimeState = { ...runtimeState, promptMode: "correction" };
  return perspective.correctionPrompt;
}

export function resetPromptRuntimeState(): void {
  runtimeState = {
    currentPerspectiveId: defaultPerspectiveId,
    lastSentPerspectiveId: null,
    currentBeatId: null,
    previousBeatId: null,
    activeCharacterIds: [],
    promptMode: "initial",
  };
}

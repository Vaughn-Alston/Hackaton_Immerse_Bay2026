import worldData from "../data/world.json";

export interface BreakableObjectState {
  objectId: string;
  health: number;
  hitCount: number;
  destroyed: boolean;
}

export interface RockHitResult {
  state: BreakableObjectState;
  prompt: string;
  event: "hit" | "destroyed" | "ignored";
}

type HumanInteractionDefinition =
  (typeof worldData.humanInteractions)[keyof typeof worldData.humanInteractions];
export type HumanInteractionAction = HumanInteractionDefinition["actions"][number];

export interface HumanInteractionState {
  interactionId: keyof typeof worldData.humanInteractions;
  active: boolean;
  stage: string;
  currentBeatId: string;
  previousBeatId: string | null;
  completedActionIds: string[];
}

export interface HumanInteractionStart {
  state: HumanInteractionState;
  initialPrompt: string;
  activeCharacterIds: string[];
}

export interface HumanInteractionResult {
  state: HumanInteractionState;
  prompt: string;
  action: HumanInteractionAction | null;
  event: "advanced" | "ignored";
}

const rockDefinition = worldData.objectTypes.breakableRock;
const defaultInteractionId = "forestGreeting" as const;

let activeHumanInteraction: HumanInteractionState = {
  interactionId: defaultInteractionId,
  active: false,
  stage: worldData.humanInteractions[defaultInteractionId].initialStage,
  currentBeatId: "not-started",
  previousBeatId: null,
  completedActionIds: [],
};

export function beginHumanInteractionTest(): HumanInteractionStart {
  const interaction = worldData.humanInteractions[defaultInteractionId];
  const locationId = interaction.locationId as keyof typeof worldData.locations;
  const location = worldData.locations[locationId];
  const elias = worldData.characters.elias;

  activeHumanInteraction = {
    interactionId: defaultInteractionId,
    active: true,
    stage: interaction.initialStage,
    currentBeatId: `${defaultInteractionId}:${interaction.initialStage}`,
    previousBeatId: null,
    completedActionIds: [],
  };

  return {
    state: activeHumanInteraction,
    activeCharacterIds: [...interaction.participantIds],
    initialPrompt: `${elias.visualIdentity.promptReference} ${interaction.openingAction} in ${location.visualIdentity.promptReference}.`,
  };
}

export function clearHumanInteractionTest(): void {
  activeHumanInteraction = {
    interactionId: defaultInteractionId,
    active: false,
    stage: worldData.humanInteractions[defaultInteractionId].initialStage,
    currentBeatId: "not-started",
    previousBeatId: null,
    completedActionIds: [],
  };
}

export function getHumanInteractionState(): HumanInteractionState {
  return activeHumanInteraction;
}

export function getAvailableHumanActions(
  state: HumanInteractionState,
): HumanInteractionAction[] {
  if (!state.active) return [];
  const interaction = worldData.humanInteractions[state.interactionId];
  return interaction.actions.filter((action) => action.fromStage === state.stage);
}

export function advanceHumanInteraction(
  state: HumanInteractionState,
  actionId: string,
): HumanInteractionResult {
  const action = getAvailableHumanActions(state).find(
    (candidate) => candidate.id === actionId,
  );
  if (!action) {
    return { state, prompt: "", action: null, event: "ignored" };
  }

  const nextState: HumanInteractionState = {
    ...state,
    stage: action.toStage,
    previousBeatId: state.currentBeatId,
    currentBeatId: `${state.interactionId}:${action.toStage}`,
    completedActionIds: [...state.completedActionIds, action.id],
  };

  return {
    state: nextState,
    prompt: action.prompt,
    action,
    event: "advanced",
  };
}

export function commitHumanInteractionState(
  state: HumanInteractionState,
): void {
  activeHumanInteraction = state;
}

export function getWorldTransitionDelayMs(): number {
  return worldData.visualPolicy.transitionDelayMs;
}

export function createRockState(): BreakableObjectState {
  return {
    objectId: worldData.defaultTestObjectId,
    health: rockDefinition.gameplay.maxHealth,
    hitCount: 0,
    destroyed: false,
  };
}

export function getRockMaxHealth(): number {
  return rockDefinition.gameplay.maxHealth;
}

export function hitRock(state: BreakableObjectState): RockHitResult {
  if (state.destroyed) {
    return { state, prompt: "", event: "ignored" };
  }

  const health = Math.max(
    0,
    state.health - rockDefinition.gameplay.damagePerHit,
  );
  const hitCount = state.hitCount + 1;
  const destroyed = health === 0;
  const nextState = { ...state, health, hitCount, destroyed };
  const rock = rockDefinition.visualIdentity.promptReference;

  if (destroyed) {
    const { fragmentCount, blastRadiusMeters } = rockDefinition.destruction;
    return {
      state: nextState,
      event: "destroyed",
      prompt: `A fist punches ${rock} again. The rock breaks into ${fragmentCount} fragments that burst only downward and outward to the left and right, spreading no farther than ${blastRadiusMeters} meters across the ground.`,
    };
  }

  return {
    state: nextState,
    event: "hit",
    prompt: `A fist enters the first-person frame and punches ${rock}. The rock shudders and a new crack spreads across its surface, but it remains intact.`,
  };
}

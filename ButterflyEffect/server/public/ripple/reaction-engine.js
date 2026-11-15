// Pure, host-agnostic action selection. Snap, Unity and WebXR can share the JSON contract.
const fill = (text, values) => Object.entries(values).reduce(
  (result, [key, value]) => result.replaceAll(`{${key}}`, value ?? key), text,
);

export function chooseReaction(config, random = Math.random) {
  const actions = config?.actions ?? [];
  if (!actions.length) throw new Error("interaction-audio.json has no actions");
  const index = Math.min(actions.length - 1, Math.floor(Math.max(0, random()) * actions.length));
  return actions[index];
}

export function reactionForResponse(config, response, context = {}, random = Math.random) {
  const classification = typeof response === "string" ? response : response?.classification ?? response?.action;
  if (classification !== config?.selection?.triggerClassification) return null;
  const action = chooseReaction(config, random);
  const templates = action.promptTemplates ?? [];
  const template = templates[Math.min(templates.length - 1, Math.floor(Math.max(0, random()) * templates.length))] ?? "";
  return {
    actionId: action.id,
    action: action.name,
    animationTrigger: action.animationTrigger,
    sound: action.sound,
    prompt: fill(template, context),
  };
}

export function objectAction(config, objectId, verb) {
  const binding = config?.objectBindings?.[objectId]?.[verb];
  return binding ? { objectId, verb, ...binding } : null;
}

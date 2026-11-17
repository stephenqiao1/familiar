export { createBrainstemRegion, type Body, type BrainstemMoment, type BrainstemOptions, type StartleDetector } from "./brainstem-region.js";
export { createDefenceWatch, type DefenceTick, type OverruledDefence } from "./defence-watch.js";
export { createReflexGain, HELD_BACK, isHeldBack, MAX_GAIN, MIN_GAIN, reflexGain, type GainInputs, type Leaning, type ReflexGainOptions } from "./gain.js";
export { createMedullaRegion, overall, type MedullaOptions, type Vitals } from "./medulla-region.js";
export { createLoadedResponses, LOADED_URGENCY, type LoadedResponses, type Thing } from "./loaded.js";
export { brainstemProblem, DEFAULT_BRAINSTEM, type BrainstemSettings } from "./settings.js";
export { AIR_SIGNAL, AROUSAL_SIGNAL, COLD_SIGNAL, HUNGER_SIGNAL, HURT_SIGNAL, RESERVE_SIGNAL, SICK_SIGNAL, TIRED_SIGNAL, URGE_SIGNAL, VITALS_SIGNAL, ORIENTING_SIGNAL, PAIN_SIGNAL, SORE_SIGNAL, STARTLE_SIGNAL, STUCK_SIGNAL, UPPER_PAUSED_SIGNAL } from "./signals.js";

export { createCerebellumRegion, type CerebellumOptions, type MeasureTrace } from "./cerebellum-region.js";
export { bounded, kept, learnChanges, learnMeasure, shareOf, sureOf, type Lesson } from "./learn.js";
export { createModels, isModel, modelId, type Estimate, type Model, type Models, type ModelStore, type Movement } from "./model.js";
export { expectedChanges, predict, trustedModel, type Prediction } from "./predict.js";
export { learnedExpectations, type Expectations } from "./expect.js";
export { faded, LARGE_MISMATCH, MISMATCH_FADE_MS, MISMATCH_SIGNAL, mismatchOf, spreadsOff, widthOf } from "./mismatch.js";
export { giveUpBase, LIMIT_BOUNDS, limitOf, SPREADS, toward, type GiveUpBase } from "./readers.js";
export { cerebellumProblem, DEFAULT_CEREBELLUM, NO_READERS, READERS, type CerebellumSettings } from "./settings.js";
export { createTiming, TIMING, type Due, type Timing } from "./timing.js";

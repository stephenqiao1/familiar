// The signals the brainstem shares. Each is 0 to 1.

/** 1 for the one tick a startle fires, else 0. */
export const STARTLE_SIGNAL = "startle";
/** 1 while something new or sudden is drawing the bot's gaze, else 0. */
export const ORIENTING_SIGNAL = "orienting";
/** How awake the bot is: about 0.05 asleep, 0.3 drowsy, toward 1 as alarm rises. */
export const AROUSAL_SIGNAL = "arousal";
/** 1 while the deciding layers above (instinct, planner) are paused because the bot sleeps undisturbed. */
export const UPPER_PAUSED_SIGNAL = "upper_paused";
/** How short of breath: 0 with full air, 1 with none. */
export const AIR_SIGNAL = "air";
/** Recent damage, fading over about 10 seconds. */
export const PAIN_SIGNAL = "pain";
/** How hungry: 0 when full, 1 when starving. */
export const HUNGER_SIGNAL = "hunger";

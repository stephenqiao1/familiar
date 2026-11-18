// The signals the brainstem shares. Each is 0 to 1.

/** 1 for the one tick a startle fires, else 0. */
export const STARTLE_SIGNAL = "startle";
/** 1 while something new or sudden is drawing the bot's gaze, else 0. */
export const ORIENTING_SIGNAL = "orienting";
/** How awake the bot is: about 0.05 asleep, 0.3 drowsy, toward 1 as alarm rises. */
export const AROUSAL_SIGNAL = "arousal";
/** 1 while the deciding layers above (instinct, planner) are paused because the bot sleeps undisturbed. */
export const UPPER_PAUSED_SIGNAL = "upper_paused";
// The vital signs below are shared by the medulla; `stuck` and `sore` by the brainstem.

/** How far below full health: 0 at full health, 1 at none. A standing level (pain is the recent sting). */
export const HURT_SIGNAL = "hurt";
/** How sick: 1 while poisoned or withering, lower for milder effects, 0 when well. */
export const SICK_SIGNAL = "sick";
/** How cold: 0 warm, 1 frozen through. */
export const COLD_SIGNAL = "cold";
/** How tired: rising with time since sleep, 1 after about three days awake. */
export const TIRED_SIGNAL = "tired";
/** The hidden food reserve behind the food bar, as a share of its maximum. */
export const RESERVE_SIGNAL = "reserve";
/** One overall number: 1 when everything is fine, pulled down mostly by the single worst reading. */
export const VITALS_SIGNAL = "vitals";
/** How strongly the body is asking for upkeep right now: the strongest urge the medulla fired this tick, 0 when none. */
export const URGE_SIGNAL = "urge";
/** How short of breath: 0 with full air, 1 with none. */
export const AIR_SIGNAL = "air";
/** Recent damage, fading over about 10 seconds. */
export const PAIN_SIGNAL = "pain";
/** 1 while the legs are stuck (trying to get free, or just gave up), fading over about 5 seconds. */
export const STUCK_SIGNAL = "stuck";
/** 1 just after pulling away from pain, fading to 0 over 30 seconds: the body is more sensitive for a while. */
export const SORE_SIGNAL = "sore";
/** How hungry: 0 when full, 1 when starving. */
export const HUNGER_SIGNAL = "hunger";
/** How unsteady the body is, 0 (firm on its feet) to 1 (in the air over a fall that would hurt). */
export const UNSTEADY_SIGNAL = "unsteady";
/** How fast something is coming at the body, 0 to 1 (the colliculus shares it; alarm and the defence reflexes read it). */
export const LOOMING_SIGNAL = "looming";
/** 1 on a tick when a response the goal loaded in advance fired. */
export const LOADED_SIGNAL = "loaded_response";
/** On the tick of a startle, `startle_from_<cause>` carries its size too, naming what set it off (so alarm does not count the same event twice). */
export const STARTLE_FROM = "startle_from_";

import type { Action } from "@familiar/contracts";
import type { Bot } from "mineflayer";

/** M0: does nothing; the app prints the chosen action each tick. Real skills arrive in M1. */
export function applyAction(_bot: Bot, _action: Action): void {}

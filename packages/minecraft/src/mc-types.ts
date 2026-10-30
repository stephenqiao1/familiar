import type { Bot } from "mineflayer";

/** Block and entity types as mineflayer exposes them, without depending on prismarine packages directly. */
export type Block = NonNullable<ReturnType<Bot["blockAt"]>>;
export type Entity = Bot["entity"];

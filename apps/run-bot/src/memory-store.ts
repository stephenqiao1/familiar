import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createMemory, type Fact, type KnownPlace, type Memory, type MemoryOptions, type MemoryStore } from "@familiar/memory";
import { createChestMemory, type ChestMemory, type ChestRecord } from "@familiar/minecraft";
import { createNoveltyMemory, createScorebook, type NoveltyMemory, type SavedScore, type Scorebook } from "@familiar/neuromodulators";

// What each bot has learned and remembers, kept between runs, one folder per bot. A missing or
// broken file means starting fresh.

export const scorebookFile = (bot: string) => `data/${bot}/scorebook.json`;
export const noveltyFile = (bot: string) => `data/${bot}/novelty.json`;
export const chestsFile = (bot: string) => `data/${bot}/chests.json`;
export const memoriesFile = (bot: string) => `data/${bot}/memories.json`;

export async function loadScorebook(file: string): Promise<Scorebook> {
  const raw = await readJson(file);
  return createScorebook(Array.isArray(raw) ? raw.filter(isSavedScore) : []);
}

export async function saveScorebook(book: Scorebook, file: string): Promise<void> {
  await writeJson(file, book.entries());
}

export async function loadNovelty(file: string): Promise<NoveltyMemory> {
  const raw = await readJson(file);
  const counts = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? Object.entries(raw) : [];
  return createNoveltyMemory(Object.fromEntries(counts.filter(([, n]) => Number.isInteger(n) && (n as number) >= 0)));
}

export async function saveNovelty(memory: NoveltyMemory, file: string): Promise<void> {
  await writeJson(file, memory.entries());
}

export async function loadChests(file: string): Promise<ChestMemory> {
  const raw = await readJson(file);
  const entries = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? Object.entries(raw) : [];
  return createChestMemory(Object.fromEntries(entries.filter(([, r]) => isChestRecord(r))) as Record<string, ChestRecord>);
}

export async function saveChests(memory: ChestMemory, file: string): Promise<void> {
  await writeJson(file, memory.entries());
}

export async function loadMemories(file: string, options: Omit<MemoryOptions, "saved"> = {}): Promise<MemoryStore> {
  const raw = (await readJson(file)) as { memories?: unknown; places?: unknown; facts?: unknown } | null;
  const memories = Array.isArray(raw?.memories) ? (raw.memories.filter(isMemory) as Memory[]) : [];
  const places = Array.isArray(raw?.places) ? (raw.places.filter((p) => isPlace((p as KnownPlace | null)?.place)) as KnownPlace[]) : [];
  const facts = Array.isArray(raw?.facts) ? (raw.facts.filter(isFact) as Fact[]) : [];
  return createMemory({ ...options, saved: { memories, places, facts } });
}

export async function saveMemories(memory: MemoryStore, file: string): Promise<void> {
  await writeJson(file, memory.entries());
}

/** The file's JSON, or null if it is missing or unreadable. */
async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** Writes to a temporary file first, so a crash mid-write never leaves a broken file. */
async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2) + "\n");
  await rename(`${file}.tmp`, file);
}

function isSavedScore(e: unknown): e is SavedScore {
  const o = e as Partial<SavedScore> | null;
  return (
    typeof o?.situation === "string" &&
    typeof o.skill === "string" &&
    typeof o.expected === "number" &&
    typeof o.benefit === "number" &&
    typeof o.cost === "number" &&
    (o.runs === undefined || typeof o.runs === "number") &&
    (o.successes === undefined || typeof o.successes === "number")
  );
}

function isChestRecord(r: unknown): r is ChestRecord {
  const o = r as Partial<ChestRecord> | null;
  return (
    typeof o?.seenAt === "number" &&
    o.contents !== null &&
    typeof o.contents === "object" &&
    Object.values(o.contents).every((n) => typeof n === "number")
  );
}

function isPlace(p: unknown): boolean {
  const o = p as { x?: unknown; y?: unknown; z?: unknown; dimension?: unknown } | null;
  return typeof o?.x === "number" && typeof o.y === "number" && typeof o.z === "number" && typeof o.dimension === "string";
}

function isMemory(m: unknown): boolean {
  const o = m as Partial<Memory> | null;
  return (
    typeof o?.id === "string" &&
    typeof o.time === "number" &&
    typeof o.kind === "string" &&
    typeof o.summary === "string" &&
    Array.isArray(o.involved) &&
    typeof o.outcome?.value === "number" &&
    typeof o.strength === "number" &&
    typeof o.strengthAt === "number" &&
    isPlace(o.place)
  );
}

function isFact(f: unknown): boolean {
  const o = f as Partial<Fact> | null;
  return typeof o?.id === "string" && typeof o.text === "string" && typeof o.involved === "string" && typeof o.confidence === "number" && typeof o.support === "number";
}

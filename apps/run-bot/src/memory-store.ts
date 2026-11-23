import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseLearnedSkills, type LearnedSkill } from "@familiar/core";
import { createMemory, type Fact, type KnownPlace, type Memory, type MemoryOptions, type MemoryStore } from "@familiar/memory";
import { createChestMemory, type ChestMemory, type ChestRecord, type SurfaceCounts, type ThreatEntries } from "@familiar/minecraft";
import { createTargetMemory, type TargetMemory } from "@familiar/region-hypothalamus";
import { createNoveltyMemory, createScorebook, type NoveltyMemory, type SavedScore, type Scorebook } from "@familiar/neuromodulators";

// What each bot has learned and remembers, kept between runs, one folder per bot. A missing or
// broken file means starting fresh.

export const scorebookFile = (bot: string) => `data/${bot}/scorebook.json`;
export const noveltyFile = (bot: string) => `data/${bot}/novelty.json`;
export const chestsFile = (bot: string) => `data/${bot}/chests.json`;
export const memoriesFile = (bot: string) => `data/${bot}/memories.json`;
export const hurtsFile = (bot: string) => `data/${bot}/hurts.json`;
export const badFoodsFile = (bot: string) => `data/${bot}/bad-foods.json`;
export const bodyFile = (bot: string) => `data/${bot}/body.json`;
export const targetsFile = (bot: string) => `data/${bot}/targets.json`;
export const surfacesFile = (bot: string) => `data/${bot}/surfaces.json`;
export const threatsFile = (bot: string) => `data/${bot}/threats.json`;
export const learnedSkillsFile = (bot: string) => `data/${bot}/learned-skills.json`;

/** What the bot has learned about how much is enough: need → how many times the usual, and when. A missing file means nothing yet; a broken entry is left out. */
export async function loadTargets(file: string): Promise<TargetMemory> {
  const raw = await readJson(file);
  const entries = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? Object.entries(raw as Record<string, { times?: unknown; at?: unknown }>) : [];
  return createTargetMemory(Object.fromEntries(entries.filter(([, e]) => typeof e?.times === "number" && e.times >= 1 && typeof e.at === "number")) as Record<string, { times: number; at: number }>);
}

export async function saveTargets(targets: TargetMemory, file: string): Promise<void> {
  await writeJson(file, targets.entries());
}

/** What the bot's body carries between runs: the world's age (in ticks) when it last woke from sleep. */
export async function loadBody(file: string): Promise<{ sleptAtAge?: number }> {
  const raw = (await readJson(file)) as { sleptAtAge?: unknown } | null;
  return typeof raw?.sleptAtAge === "number" && raw.sleptAtAge >= 0 ? { sleptAtAge: raw.sleptAtAge } : {};
}

export async function saveBody(body: { sleptAtAge: number }, file: string): Promise<void> {
  await writeJson(file, body);
}

/** What the bot has learned about surfaces: for loose, slippery and slow, block type → times it showed. A missing file means nothing yet. */
export async function loadSurfaces(file: string): Promise<Partial<SurfaceCounts>> {
  const raw = await readJson(file);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const counts = (kind: string) => Object.fromEntries(Object.entries((raw as Record<string, unknown>)[kind] ?? {}).filter(([, n]) => Number.isInteger(n) && (n as number) > 0)) as Record<string, number>;
  return { loose: counts("loose"), slippery: counts("slippery"), slow: counts("slow") };
}

export async function saveSurfaces(surfaces: SurfaceCounts, file: string): Promise<void> {
  await writeJson(file, surfaces);
}

/** What the bot has learned about each kind of threat. A missing file means nothing yet; a broken entry is left out. */
export async function loadThreats(file: string): Promise<ThreatEntries> {
  const raw = await readJson(file);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const whole = (n: unknown) => Number.isFinite(n) && (n as number) >= 0;
  const ok = (c: unknown): c is ThreatEntries[string] => {
    if (c === null || typeof c !== "object") return false;
    const e = c as Record<string, unknown>;
    return ["seen", "hurts", "damage", "kills", "deaths", "badLosses", "rangedHurts"].every((key) => whole(e[key])) && whole(e.danger) && (e.danger as number) <= 1;
  };
  return Object.fromEntries(Object.entries(raw).filter(([, c]) => ok(c))) as ThreatEntries;
}

export async function saveThreats(threats: ThreatEntries, file: string): Promise<void> {
  await writeJson(file, threats);
}

/**
 * A learned record of counts: what the bot has learned hurts (block type → times it hurt), or
 * which foods are bad (food → times illness followed). A missing file means nothing yet.
 */
export async function loadHurts(file: string): Promise<Record<string, number>> {
  const raw = await readJson(file);
  const entries = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? Object.entries(raw) : [];
  return Object.fromEntries(entries.filter(([, n]) => Number.isInteger(n) && (n as number) > 0)) as Record<string, number>;
}

export async function saveHurts(hurts: Record<string, number>, file: string): Promise<void> {
  await writeJson(file, hurts);
}

/**
 * The bot's learned skills: chains of primitives kept as data. A missing or empty file means none.
 * `problems` lists entries that were left out and why.
 */
export async function loadLearnedSkills(file: string, primitiveNames: string[], takenNames: string[]): Promise<{ skills: LearnedSkill[]; problems: string[] }> {
  return parseLearnedSkills(await readJson(file), primitiveNames, takenNames);
}

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
    typeof o?.feature === "string" &&
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

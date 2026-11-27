// Replays recorded runs through the two deciders twice, side by side: as the plain regions they
// were (the goal read from the workspace), and as areas of the cortex (the goal fed down the
// ladder). The recorded answers of Jev and of the planner are played back, so both sides are asked
// the same things. It checks that the two sides set the same goals, ask the same questions and
// make the same proposals, and how far each agrees with what was recorded.
//   pnpm replay-cortex logs/player-....jsonl [more logs]
// Not replayed: which skills can run (the menu is read back from the recorded question), the
// thalamus (both sides read the full state, so the target options are compared side to side
// only), and the planner's situation text (the recorded one is played back).
// Against the recording a few ticks can differ for a reason that is not the areas': the log has
// each tick's signals and goal as they stood at its end, and a plan is logged when it comes back.
import { readFileSync } from "node:fs";
import type { Answer, Feedback, Goal, Plan, Proposal, Question, Region, Skill, State, Workspace } from "@familiar/contracts";
import { createWorkspace, type WorkspaceStore } from "@familiar/core";
import { playerInstinct } from "@familiar/minecraft";
import { areaRegions } from "@familiar/neocortex";
import { createInstinctArea, createInstinctRegion } from "@familiar/region-instinct";
import { createPrefrontalArea, createPrefrontalRegion } from "@familiar/region-prefrontal";
import { LADDER } from "../dist/brain.js";

interface Recorded {
  state: State & { data: { current?: { skill: string; target?: string } | null } };
  regions: { region: string; proposals: Proposal[]; trace?: { questions?: Question[]; answers?: Answer[]; plan?: Plan; situation?: string; paused?: boolean } }[];
  goal: Goal | null;
  signals: Record<string, { value: number }>;
  attended?: Parameters<ReturnType<WorkspaceStore["viewFor"]>["setAttended"]>[0];
}

const ASK = "Which skill should the player do next?\n";
const signal = new AbortController().signal;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** A goal without the times it was set and stepped (they are the replay's own clock). */
/**
 * A goal as the runs recorded before the motor area wrote it: without the steps in full, the
 * priority and the protection, and with each hold-back as its name (so an old recording compares).
 */
const plain = (goal: Goal | null) => {
  if (!goal) return goal;
  const { specs: _specs, priority: _priority, protected: _protected, doneWhen: _doneWhen, expect: _expect, ...old } = goal;
  return { ...old, holdBack: goal.holdBack.map((h) => (typeof h === "string" ? h : h.name)), setAt: 0, stepDoneAt: goal.stepDoneAt === null ? null : 1 };
};
const acts = (proposals: Proposal[]) => proposals.map((p) => ({ action: p.action, urgency: Number(p.urgency.toFixed(6)) }));
/** The menu a recorded question offered: each skill's name and description, read back from its prompt. */
function menuOf(question: Question | undefined): { name: string; description: string }[] {
  if (question?.kind !== "choice" || !question.prompt.includes(ASK)) return [];
  const lines = question.prompt.slice(question.prompt.indexOf(ASK) + ASK.length).split("\n");
  return lines.map((line) => /^- ([^:]+): (.*?)( \(in progress: choose it to keep going\))?$/.exec(line)).flatMap((m) => (m ? [{ name: m[1]!, description: m[2]! }] : []));
}

/** One side of the replay: its own workspace, and the two deciders built one way. */
function side(areas: boolean, tape: { answers: Answer[]; plan: Plan; situation: string; menu: { name: string; description: string }[]; targets: Set<string> }) {
  const store = createWorkspace();
  const stub = ({ name, description }: { name: string; description: string }): Skill<null> => ({ name, description, canRun: (_ctx, target) => target === undefined || tape.targets.has(`${name} ${target}`), run: async () => ({ status: "done" }) }) as Skill<null>;
  const level = (name: string) => store.signals()[name]?.value ?? 0;
  // The menu changes from tick to tick, so the player's instinct is built afresh from the one on the tape.
  const instinct = () => playerInstinct(tape.menu.map(stub), null, () => level("search") > 0.6, false, () => level("frazzled") > 0);
  const instinctOptions = { engine: { name: "tape", decide: async () => tape.answers }, questions: (ws: Workspace, feedback?: Feedback | null) => instinct().questions(ws, feedback), toProposals: (answers: Answer[], ws: Workspace) => instinct().toProposals(answers, ws) };
  const prefrontalOptions = { planner: { name: "tape", plan: async () => tape.plan }, describe: () => tape.situation };
  const [hold, prefrontal] = areas ? (areaRegions(createPrefrontalArea(prefrontalOptions), LADDER) as [Region, Region]) : [null, createPrefrontalRegion(prefrontalOptions)];
  const decider = areas ? areaRegions(createInstinctArea(instinctOptions), LADDER)[0]! : createInstinctRegion(instinctOptions);
  return {
    store,
    plan: () => prefrontal.run(store.viewFor("prefrontal"), signal),
    hold: () => hold?.run(store.viewFor(hold.name), signal),
    decide: async () => {
      const out = await decider.run(store.viewFor("instinct"), signal);
      return { questions: (out.trace as { questions?: Question[] }).questions ?? [], proposals: out.proposals };
    },
  };
}

async function replay(ticks: Recorded[]) {
  const tape = { answers: [] as Answer[], plan: { goal: "", steps: [], reason: "" } as Plan, situation: "", menu: [] as { name: string; description: string }[], targets: new Set<string>() };
  const [old, now] = [side(false, tape), side(true, tape)];
  const counts = { ticks: ticks.length, plans: 0, goalsSame: 0, goalsAsRecorded: 0, otherGoals: 0, asked: 0, questionsSame: 0, promptsAsRecorded: 0, proposalsSame: 0, proposalsAsRecorded: 0 };
  let firstMiss: string | null = null;
  const miss = (text: string) => (firstMiss ??= text);
  for (const [i, tick] of ticks.entries()) {
    const current = tick.state.data.current ? { skill: tick.state.data.current.skill, target: tick.state.data.current.target, startedAt: 0 } : null;
    for (const { store } of [old, now]) {
      store.update(tick.state, current);
      const ws = store.viewFor("replay");
      for (const [name, s] of Object.entries(tick.signals)) ws.setSignal(name, s.value);
      ws.setAttended(tick.attended ?? null);
    }
    // A plan that came back: both sides are handed it.
    for (const log of tick.regions.filter((r) => r.region === "prefrontal" && r.trace?.plan)) {
      Object.assign(tape, { plan: log.trace!.plan, situation: log.trace!.situation ?? "" });
      await Promise.all([old.plan(), now.plan()]);
      counts.plans++;
      if (same(plain(old.store.goal()), plain(now.store.goal()))) counts.goalsSame++;
      else miss(`tick ${i}: the two sides set different goals`);
      if (same(plain(now.store.goal()), plain(tick.goal))) counts.goalsAsRecorded++;
    }
    // A goal something else set or dropped (the forced retreat, an alarm): both sides are given it.
    if (!same(plain(now.store.goal()), plain(tick.goal)) && tick.goal?.setBy !== "prefrontal") {
      counts.otherGoals++;
      for (const { store } of [old, now]) {
        if (tick.goal) store.viewFor(tick.goal.setBy).setGoal(tick.goal);
        else store.viewFor("replay").clearGoal();
      }
    }
    await now.hold();
    const recorded = tick.regions.find((r) => r.region === "instinct" && r.trace?.questions?.length);
    if (!recorded) continue;
    const asked = recorded.trace!.questions!;
    Object.assign(tape, { answers: recorded.trace!.answers ?? [], menu: menuOf(asked.find((q) => q.id === "next_action")), targets: new Set(recorded.proposals.flatMap((p) => ("skill" in p.action && p.action.target ? [`${p.action.skill} ${p.action.target}`] : []))) });
    const [before, after] = await Promise.all([old.decide(), now.decide()]);
    counts.asked++;
    if (same(before.questions, after.questions)) counts.questionsSame++;
    else miss(`tick ${i}: the two sides asked different questions`);
    const prompt = (questions: Question[]) => questions.find((q) => q.id === "next_action");
    if (same(prompt(after.questions), prompt(asked))) counts.promptsAsRecorded++;
    if (same(before.proposals, after.proposals)) counts.proposalsSame++;
    else miss(`tick ${i}: the two sides made different proposals`);
    if (same(acts(after.proposals), acts(recorded.proposals))) counts.proposalsAsRecorded++;
  }
  return { counts, firstMiss };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: pnpm replay-cortex <tick log> [more logs]");
  process.exit(1);
}
let failed = false;
for (const file of files) {
  const ticks = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Recorded).filter((t) => t.regions);
  const { counts: c, firstMiss } = await replay(ticks);
  const ok = c.goalsSame === c.plans && c.questionsSame === c.asked && c.proposalsSame === c.asked;
  failed ||= !ok;
  console.log(`${file}: ${c.ticks} ticks`);
  console.log(`  goals      ${c.plans} plans: the two sides agree on ${c.goalsSame}; ${c.goalsAsRecorded} as recorded (${c.otherGoals} goals set or dropped by something else)`);
  console.log(`  questions  ${c.asked} asked: the two sides agree on ${c.questionsSame}; the action question is as recorded on ${c.promptsAsRecorded}`);
  console.log(`  proposals  the two sides agree on ${c.proposalsSame} of ${c.asked}; ${c.proposalsAsRecorded} as recorded`);
  console.log(`  ${ok ? "the areas do what the regions did" : `DIFFERENT: ${firstMiss}`}`);
}
process.exit(failed ? 1 : 0);

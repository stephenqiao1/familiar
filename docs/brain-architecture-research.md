# Brain Architecture Research

Goal: shape Familiar so its parts work like regions of a brain, and so that adding or changing a region means touching as few files as possible.

## 1. Where the code is today

The repo is already cleanly split into packages:

| Package | Job |
|---|---|
| `contracts` | Shared types only (State, Question, Answer, Action, Skill, DecisionEngine). |
| `core` | The tick loop, skill executor, logger. Game-agnostic. |
| `engine-jev`, `engine-echo` | Things that answer questions. |
| `minecraft` | Everything that touches the game: state encoding, skills, safety checks. |
| `apps/run-bot` | Wires it all together. |

What's missing for a brain-style design:

1. **Only one "brain part" can run.** The loop takes exactly one `DecisionEngine` (`packages/core/src/loop.ts`). There is no reflex layer or LLM layer in code yet.
2. **Reflexes are hidden inside text and skills.** "Flee when a mob is close" lives in a prompt string (`MINER_CONTEXT` in `packages/minecraft/src/miner-questions.ts`), and safety rules live inside skills (`safety.ts`). They aren't a separate part you can study or turn off.
3. **Parts can't talk to each other.** There's no shared place where one part leaves information (e.g. "I'm scared", "current goal: find iron") for others to read.
4. **Wiring is manual.** Adding a part means editing `loop-mode.ts`, `create-engine.ts`, `args.ts`, and probably `core/loop.ts`.
5. **Choosing the action is hard-coded.** `answersToAction` just takes Jev's choice. The code already notes an "Arbiter" is planned for M3 — that's the right idea.

## 2. What brain research and AI research suggest

Five well-known ideas fit this project directly.

**a. Layers that run at different speeds (Brooks' subsumption architecture, 1986).**
Fast, simple layers sit underneath slow, smart ones. A fast layer can override a slow one in an emergency. This matches the brain: spinal reflexes (milliseconds) → brainstem/limbic drives (fast) → cortex (slow, deliberate).
→ *Reflex (rules) runs every tick, Instinct (Jev) runs every tick or two, Neocortex (LLM) runs every few seconds in the background.*

**b. One shared "workspace" everyone reads and writes (Global Workspace Theory — Baars 1988, Dehaene).**
Brain regions don't call each other directly. They post information to a shared stage, and what wins attention gets broadcast to everyone.
→ *A blackboard object (e.g. `workspace.goal`, `workspace.fear`, `workspace.lastFailure`). Parts communicate only through it, never by importing each other.*

**c. One central action picker (basal ganglia — Redgrave, Prescott & Gurney 1999).**
Many brain regions propose actions at once. The basal ganglia pick one winner based on how urgent each proposal is ("salience") and block the rest.
→ *Every part returns proposals like `{ action, urgency, reason }`. One Arbiter picks the winner. This is the planned M3 Arbiter.*

**d. The cortex guides rather than steers (prefrontal "top-down bias" — Miller & Cohen 2001).**
The prefrontal cortex mostly sets goals and nudges lower areas; it doesn't control each muscle.
→ *The LLM should mainly write goals/plans into the workspace. Jev reads the goal and picks skills. The LLM is too slow to choose actions tick by tick.*

**e. Cognitive architectures already built this way (ACT-R, Soar, LIDA).**
ACT-R is literally: separate modules, each with a small "buffer" others can read, plus a central selector modelled on the basal ganglia. LIDA implements Global Workspace Theory. They're good references, and confirm the shape: **modules + shared workspace + central selector**.

## 3. Proposed design

### The three building blocks

```
             ┌──────────────── Workspace (shared memory) ────────────────┐
             │  state · goal · drives (fear, hunger) · recent events     │
             └───────▲───────────────▲───────────────────▲───────────────┘
                     │ read/write    │ read/write        │ read/write
               ┌─────┴────┐    ┌─────┴─────┐      ┌──────┴──────┐
               │  Reflex  │    │ Instinct  │      │  Neocortex  │   ← "regions"
               │ (rules)  │    │  (Jev)    │      │   (LLM)     │
               │ every tick│   │ every tick│      │ every ~5 s  │
               └─────┬────┘    └─────┬─────┘      └──────┬──────┘
                     │ proposals     │ proposals         │ (mostly writes goals)
                     ▼               ▼                   ▼
                   ┌───────────── Arbiter (basal ganglia) ─────────────┐
                   │ picks one action by urgency + layer priority      │
                   └───────────────────────┬───────────────────────────┘
                                           ▼
                                    Skill executor → Minecraft
```

**1. One interface for every brain region** (goes in `contracts`):

```ts
interface Region {
  name: string;                 // "reflex", "instinct", "neocortex"
  everyMs: number;              // how often it runs
  run(ws: Workspace): Promise<Proposal[]> | Proposal[];
}

interface Proposal {
  action: Action;
  urgency: number;              // 0..1
  reason: string;               // for logs / research
}
```

**2. A Workspace** — a typed shared object. Regions read state and each other's outputs from it and write their own signals into it. No region imports another region.

**3. An Arbiter** — takes all proposals, picks one. Simple first rule: highest urgency wins, ties go to the faster layer. Swappable later (e.g. for a learned selector).

### How the three regions fit

| Region | Uses | Reads | Writes / proposes |
|---|---|---|---|
| Reflex | Plain TS rules | state | Proposals with urgency 1.0 in emergencies (lava, mob close, low health) |
| Instinct | Jev | state, `goal`, drives | Skill proposals each tick; drive levels (fear, hunger) |
| Neocortex | LLM | state, recent events, failures | `goal` / plan; occasionally a proposal |

Engines (Jev, LLM, echo) stay as interchangeable *tools* a region uses, not regions themselves. So you could try "Instinct powered by a small LLM" by changing one line.

### "Edit minimal files" — what that looks like

- **One file lists the brain:** e.g. `apps/run-bot/src/brain.ts`
  ```ts
  export const brain = [reflex(rules), instinct(jev), neocortex(llm)];
  ```
- **Add a region:** create one file, add one line to that list.
- **Turn a region off for an experiment:** delete or comment one line (or a `--regions reflex,instinct` flag).
- **Add a reflex rule:** add one entry to a rules file.
- **Add a skill:** unchanged — one file + one line in `skills/index.ts`.

### Suggested folder layout

```
packages/
  contracts/        + region.ts, workspace.ts, proposal.ts
  core/             + arbiter.ts, brain-loop.ts   (runs regions at their own pace)
  engine-jev/       (unchanged)
  engine-llm/       new: LLM engine
  minecraft/
    regions/
      reflex.ts       rules → proposals
      instinct.ts     Jev questions → proposals
      neocortex.ts    LLM → goals
apps/run-bot/
  brain.ts          the one list of regions
```

### Built-in research value

Log every tick's proposals, urgencies, the winner, and the reason. Then you can answer questions like "how often did reflexes override the cortex?" or "what happens to survival with the neocortex removed?" — the brain equivalent of lesion studies.

## 4. Decisions for you

1. **Should the LLM choose actions directly, or only set goals?** Recommendation: goals only (closer to the brain, and LLMs are slow).
2. **How should the Arbiter decide?** Recommendation: start with "highest urgency, ties to the faster layer"; make it learnable later.
3. **Should regions be packages or files?** Recommendation: files inside `minecraft/regions/` for now; only split into packages if they get large.

## 5. Suggested order of work

1. Add `Region`, `Proposal`, `Workspace` types and the Arbiter (no behaviour change: wrap today's Jev setup as the only region).
2. Pull the reflex rules out of the prompt/skills into a Reflex region.
3. Add the LLM engine and Neocortex region writing goals; feed `goal` into Jev's questions.
4. Add per-region logging and a `--regions` flag for lesion experiments.

## References

- Brooks, R. (1986). *A robust layered control system for a mobile robot.*
- Baars, B. (1988). *A Cognitive Theory of Consciousness* (Global Workspace Theory); Dehaene & Changeux, global neuronal workspace.
- Redgrave, Prescott & Gurney (1999). *The basal ganglia: a vertebrate solution to the selection problem?*
- Miller & Cohen (2001). *An integrative theory of prefrontal cortex function.*
- Anderson, J. (2007). *How Can the Human Mind Occur in the Physical Universe?* (ACT-R).
- Franklin et al., LIDA cognitive architecture.
- Kahneman (2011), "System 1 / System 2" — a useful plain-language framing of fast vs. slow layers.

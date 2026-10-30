import type { Answer, TickLog } from "@familiar/contracts";

/**
 * One console line per tick: the next_action answer (with its probability and confidence),
 * engine latency, the other answers, and the tick's skill events. E.g.
 *   tick 12  attack p=0.76 conf=0.68  184ms  target=entity:42 in_danger=0.81 mining_spot_quality=3.5  | attack started
 */
export function formatTick(entry: TickLog): string {
  const choice = entry.answers.find((a) => a.kind === "choice" && a.id === "next_action");
  const decision =
    choice?.kind === "choice"
      ? `${choice.choice} p=${(choice.probabilities[choice.choice] ?? 0).toFixed(2)} conf=${choice.confidence.toFixed(2)}`
      : "keepGoing" in entry.action
        ? "keep going"
        : entry.action.skill;
  const others = entry.answers.filter((a) => a !== choice).map(short);
  const rest = others.length ? `  ${others.join(" ")}` : "";
  const events = entry.skillEvents?.length
    ? `  | ${entry.skillEvents.map((e) => `${e.skill}${e.target ? ` (${e.target})` : ""} ${e.type}${e.reason ? ` (${e.reason})` : ""}`).join(", ")}`
    : "";
  return `tick ${entry.tick}  ${decision}  ${entry.engineLatencyMs.toFixed(0)}ms${rest}${events}`;
}

function short(a: Answer): string {
  switch (a.kind) {
    case "choice":
      return `${a.id}=${a.choice}`;
    case "noul":
      return `${a.id}=${a.value.toFixed(2)}`;
    case "score":
      return `${a.id}=${a.score.toFixed(1)}`;
  }
}

import { env } from "../env.js";
import { runDueChecksOnce } from "./engine.js";

let timer: NodeJS.Timeout | null = null;
let running = false;
let started = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const outcomes = await runDueChecksOnce();
    for (const outcome of outcomes) {
      const flag = outcome.incidentCreated ? " [INCIDENT DOWN]" : outcome.incidentResolved ? " [INCIDENT RECOVERED]" : "";
      console.log(
        `[engine] ${outcome.monitorId} -> ${outcome.result.success ? "OK" : "FAIL"} (${outcome.result.statusCode ?? outcome.result.errorType ?? "error"}, ${outcome.result.responseTimeMs}ms)${flag}`,
      );
    }
  } catch (err) {
    // Never let a tick failure stop the scheduler.
    console.error("[engine] tick error:", err);
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  if (started) return;
  started = true;
  const intervalMs = Math.max(1, env.schedulerTickSeconds) * 1000;
  console.log(`[engine] scheduler started (tick every ${intervalMs / 1000}s, concurrency ${env.checkConcurrency})`);
  void tick();
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

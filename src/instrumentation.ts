export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    const { startBotScheduler } = await import("./lib/bot/scheduler");
    startBotScheduler();
  } catch (error) {
    console.warn("[instrumentation] bot scheduler failed to start", error);
  }
}

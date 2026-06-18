import { solveSkimmiq } from "./skimmiq-solver.js";

self.onmessage = (event) => {
  const message = event.data;
  if (message.type !== "solve") return;

  try {
    const result = solveSkimmiq(message.state, {
      timeoutMs: message.timeoutMs ?? 25000,
      maxDepth: message.maxDepth ?? 28,
      beamWidth: message.beamWidth,
      onProgress: (progress) => {
        self.postMessage({ type: "progress", progress });
      }
    });
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

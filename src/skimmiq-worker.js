import { solveSkimmiq } from "./skimmiq-solver.js";
import { solveSkimmiqWasm } from "./skimmiq-wasm.js";

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type !== "solve") return;

  try {
    const options = {
      timeoutMs: message.timeoutMs ?? 25000,
      maxDepth: message.maxDepth ?? 28,
      beamWidth: message.beamWidth,
      onProgress: (progress) => {
        self.postMessage({ type: "progress", progress });
      }
    };

    if (message.useWasm !== false) {
      try {
        self.postMessage({
          type: "progress",
          progress: { phase: "wasm-solve", depth: 0, nodes: 0, frontier: 0, elapsedMs: 0 }
        });
        const wasmResult = await solveSkimmiqWasm(message.state, options);
        if (wasmResult.status === "solved") {
          self.postMessage({ type: "result", result: wasmResult });
          return;
        }
        self.postMessage({
          type: "progress",
          progress: { phase: "js-fallback", depth: 0, nodes: wasmResult.nodes, frontier: 0, elapsedMs: wasmResult.elapsedMs }
        });
      } catch (error) {
        self.postMessage({
          type: "progress",
          progress: {
            phase: "js-fallback",
            depth: 0,
            nodes: 0,
            frontier: 0,
            elapsedMs: 0,
            reason: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }

    const result = solveSkimmiq(message.state, options);
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

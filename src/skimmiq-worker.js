import { solveSkimmiqWasm } from "./skimmiq-wasm.js";

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type !== "solve") return;

  try {
    const options = {
      timeoutMs: message.timeoutMs ?? 25000,
      tableDepth: message.tableDepth,
      forwardDepth: message.forwardDepth,
      macroTiers: message.macroTiers,
      macroDepth: message.macroDepth,
      macroWidth: message.macroWidth,
      macroRestarts: message.macroRestarts
    };

    self.postMessage({
      type: "progress",
      progress: { phase: "wasm-solve", depth: 0, nodes: 0, frontier: 0, elapsedMs: 0 }
    });
    const result = await solveSkimmiqWasm(message.state, options);
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

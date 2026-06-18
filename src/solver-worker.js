import { CubieCube } from "./cube.js";
import { KociembaSolver } from "./solver.js";

const solver = new KociembaSolver();

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type !== "solve") return;

  try {
    const cube = CubieCube.fromJSON(message.cube);
    const result = await solver.solve(cube, {
      maxDepth: message.maxDepth ?? 30,
      timeoutMs: message.timeoutMs ?? 60000,
      onProgress: (progress) => {
        self.postMessage({ type: "progress", progress });
      },
      onSearch: (search) => {
        self.postMessage({ type: "search", search });
      }
    });

    if (!result) {
      self.postMessage({ type: "failed", reason: "No solution was found within the configured limit." });
      return;
    }

    self.postMessage({ type: "solution", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

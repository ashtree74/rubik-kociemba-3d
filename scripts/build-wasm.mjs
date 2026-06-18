import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "wasm/skimmiq_solver/Cargo.toml");
const outputPath = resolve(root, "src/wasm/skimmiq_solver.wasm");
const builtPath = resolve(
  root,
  "wasm/skimmiq_solver/target/wasm32-unknown-unknown/release/skimmiq_solver_wasm.wasm"
);

const rustc = rustupWhich("rustc");
const cargo = rustupWhich("cargo") || "cargo";
const env = rustc ? { ...process.env, RUSTC: rustc } : process.env;

const result = spawnSync(
  cargo,
  ["build", "--release", "--target", "wasm32-unknown-unknown", "--manifest-path", manifestPath],
  { cwd: root, env, stdio: "inherit" }
);

if (result.status !== 0) process.exit(result.status ?? 1);

mkdirSync(dirname(outputPath), { recursive: true });
copyFileSync(builtPath, outputPath);
console.log(`WASM copied to ${outputPath}`);

function rustupWhich(binary) {
  const result = spawnSync("rustup", ["which", binary], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

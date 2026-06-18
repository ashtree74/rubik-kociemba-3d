import "./styles.css";
import "./skimmiq.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  SKIMMIQ_DIFFICULTIES,
  SKIMMIQ_LAYOUTS,
  SkimmiqPuzzle,
  colorCodeToName,
  deterministicSkimmiqScramble,
  skimmiqMoveToString,
  skimmiqMovesToString
} from "./skimmiq-model.js";

const COLOR_HEX = {
  white: 0xf7f7f2,
  red: 0xff3030,
  blue: 0x1f4fff,
  magenta: 0xdb00cc,
  green: 0x00c864,
  yellow: 0xffe85c
};

const FACE_AXES = {
  front: {
    normal: new THREE.Vector3(0, 0, 1),
    localX: new THREE.Vector3(1, 0, 0),
    localY: new THREE.Vector3(0, 1, 0)
  },
  back: {
    normal: new THREE.Vector3(0, 0, -1),
    localX: new THREE.Vector3(-1, 0, 0),
    localY: new THREE.Vector3(0, 1, 0)
  },
  left: {
    normal: new THREE.Vector3(-1, 0, 0),
    localX: new THREE.Vector3(0, 0, 1),
    localY: new THREE.Vector3(0, 1, 0)
  },
  right: {
    normal: new THREE.Vector3(1, 0, 0),
    localX: new THREE.Vector3(0, 0, -1),
    localY: new THREE.Vector3(0, 1, 0)
  },
  top: {
    normal: new THREE.Vector3(0, 1, 0),
    localX: new THREE.Vector3(1, 0, 0),
    localY: new THREE.Vector3(0, 0, -1)
  },
  bottom: {
    normal: new THREE.Vector3(0, -1, 0),
    localX: new THREE.Vector3(1, 0, 0),
    localY: new THREE.Vector3(0, 0, 1)
  }
};

const SKIMMIQ_CELL_SPACING = 0.92;
const SKIMMIQ_BODY_SIZE = 0.91;
const SKIMMIQ_STICKER_SIZE = 0.72;
const SKIMMIQ_STICKER_DEPTH = 0.032;
const SKIMMIQ_STICKER_OFFSET = SKIMMIQ_BODY_SIZE / 2 + SKIMMIQ_STICKER_DEPTH / 2 + 0.006;

const canvas = document.querySelector("#skimmiqCanvas");
const stateLabel = document.querySelector("#skimmiqStateLabel");
const solverLabel = document.querySelector("#skimmiqSolverLabel");
const layoutLabel = document.querySelector("#skimmiqLayoutLabel");
const difficultyLabel = document.querySelector("#skimmiqDifficultyLabel");
const moveLabel = document.querySelector("#skimmiqMoveLabel");
const progressText = document.querySelector("#skimmiqProgressText");
const progressMeta = document.querySelector("#skimmiqProgressMeta");
const layoutControls = document.querySelector("#skimmiqLayoutControls");
const difficultyControls = document.querySelector("#skimmiqDifficultyControls");
const moveControls = document.querySelector("#skimmiqMoveControls");
const scrambleBtn = document.querySelector("#skimmiqScrambleBtn");
const solveBtn = document.querySelector("#skimmiqSolveBtn");
const resetBtn = document.querySelector("#skimmiqResetBtn");
const clearLogBtn = document.querySelector("#skimmiqClearLogBtn");
const speedRange = document.querySelector("#skimmiqSpeedRange");
const moveLog = document.querySelector("#skimmiqMoveLog");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xede9df);

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
camera.position.set(4.6, 3.8, 6.4);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 4;
controls.maxDistance = 13;
controls.target.set(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x191820, 2.7));
const key = new THREE.DirectionalLight(0xffffff, 3.4);
key.position.set(4.5, 6, 5);
key.castShadow = true;
scene.add(key);
const fill = new THREE.DirectionalLight(0x40dff4, 1.2);
fill.position.set(-5, 2, -4);
scene.add(fill);

const group = new THREE.Group();
scene.add(group);

let puzzle = new SkimmiqPuzzle("E", "classic");
let selectedLayoutId = "E";
let selectedDifficultyId = "classic";
let stickerMeshes = new Map();
let busy = false;
let worker = null;
let history = [];
let lastMove = null;
let layoutMode = "";

renderLayoutButtons();
renderDifficultyButtons();
rebuildPuzzle();
resize();
animate();

window.addEventListener("resize", resize);
scrambleBtn.addEventListener("click", () => runScramble());
solveBtn.addEventListener("click", () => runSolver());
resetBtn.addEventListener("click", () => resetPuzzle());
clearLogBtn.addEventListener("click", () => {
  history = [];
  renderMoveLog();
});

function renderLayoutButtons() {
  layoutControls.textContent = "";
  for (const layout of Object.values(SKIMMIQ_LAYOUTS)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = layout.label;
    button.title = layout.title;
    button.addEventListener("click", () => {
      if (busy) return;
      selectedLayoutId = layout.id;
      rebuildPuzzle();
    });
    layoutControls.appendChild(button);
  }
}

function renderDifficultyButtons() {
  difficultyControls.textContent = "";
  for (const difficulty of Object.values(SKIMMIQ_DIFFICULTIES)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = difficulty.label;
    button.addEventListener("click", () => {
      if (busy) return;
      selectedDifficultyId = difficulty.id;
      rebuildPuzzle();
    });
    difficultyControls.appendChild(button);
  }
}

function rebuildPuzzle() {
  puzzle = new SkimmiqPuzzle(selectedLayoutId, selectedDifficultyId);
  history = [];
  lastMove = null;
  layoutMode = "";
  buildSceneStickers();
  renderMoveButtons();
  renderMoveLog();
  updateLabels();
  solverLabel.textContent = "Ready";
  setSolverProgress("Ready", "0 states");
  resize();
}

function buildSceneStickers() {
  group.clear();
  stickerMeshes = new Map();

  const bodyGeometry = new RoundedBoxGeometry(
    SKIMMIQ_BODY_SIZE,
    SKIMMIQ_BODY_SIZE,
    SKIMMIQ_BODY_SIZE,
    5,
    0.04
  );
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x111119,
    roughness: 0.72,
    metalness: 0.02
  });
  const stickerGeometry = new RoundedBoxGeometry(
    SKIMMIQ_STICKER_SIZE,
    SKIMMIQ_STICKER_SIZE,
    SKIMMIQ_STICKER_DEPTH,
    5,
    0.026
  );
  const basisMatrix = new THREE.Matrix4();

  for (let x = 0; x < puzzle.layout.rows; x += 1) {
    for (let y = 0; y < puzzle.layout.cols; y += 1) {
      for (let z = 0; z < puzzle.layout.layers; z += 1) {
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.set(
          centerCoordinate(x, puzzle.layout.rows),
          centerCoordinate(y, puzzle.layout.cols),
          centerCoordinate(z, puzzle.layout.layers)
        );
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
      }
    }
  }

  for (let index = 0; index < puzzle.stickers.length; index += 1) {
    const sticker = puzzle.stickers[index];
    const axes = FACE_AXES[sticker.face];
    const tile = new THREE.Group();
    basisMatrix.makeBasis(axes.localX, axes.localY, axes.normal);
    tile.quaternion.setFromRotationMatrix(basisMatrix);
    tile.position.set(
      centerCoordinate(sticker.x, puzzle.layout.rows),
      centerCoordinate(sticker.y, puzzle.layout.cols),
      centerCoordinate(sticker.z, puzzle.layout.layers)
    );
    tile.position.addScaledVector(axes.normal, SKIMMIQ_STICKER_OFFSET);

    const material = new THREE.MeshStandardMaterial({
      color: COLOR_HEX[colorCodeToName(puzzle.colors[index])],
      roughness: 0.5,
      metalness: 0
    });
    const mesh = new THREE.Mesh(stickerGeometry, material);
    mesh.userData = { stickerIndex: index, sticker };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    tile.add(mesh);

    stickerMeshes.set(index, mesh);
    group.add(tile);
  }
}

function renderMoveButtons() {
  moveControls.textContent = "";
  const tapes = puzzle.tapes.slice().sort((a, b) => a.id.localeCompare(b.id));
  for (const tape of tapes) {
    const row = document.createElement("div");
    row.className = "tape-row";
    const label = document.createElement("span");
    label.textContent = tape.id;
    row.appendChild(label);
    for (const direction of [-1, 1]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = direction > 0 ? "+1" : "-1";
      button.dataset.move = `${tape.id}${direction > 0 ? "+" : "-"}`;
      button.addEventListener("click", () => runMove({ tapeId: tape.id, direction }));
      row.appendChild(button);
    }
    moveControls.appendChild(row);
  }
}

async function runMove(move, options = {}) {
  if (busy) return;
  busy = true;
  setControlsDisabled(true);
  try {
    await applyVisualMove(move);
    if (options.log !== false) {
      history.push(move);
      renderMoveLog();
    }
    lastMove = move;
    updateLabels();
  } finally {
    busy = false;
    solverLabel.textContent = "Ready";
    setSolverProgress("Ready", "0 states");
    setControlsDisabled(false);
  }
}

async function runSequence(moves, status, options = {}) {
  if (busy) return;
  busy = true;
  setControlsDisabled(true);
  solverLabel.textContent = status;
  try {
    for (const move of moves) {
      await applyVisualMove(move);
      if (options.log !== false) history.push(move);
      lastMove = move;
      renderMoveLog();
      updateLabels();
    }
  } finally {
    busy = false;
    solverLabel.textContent = options.finalStatus || "Ready";
    if (options.finalProgress) setSolverProgress(options.finalProgress.text, options.finalProgress.meta);
    setControlsDisabled(false);
  }
}

async function applyVisualMove(move) {
  const resolved = puzzle.getMove(move);
  const meshes = resolved.cycle.map((index) => stickerMeshes.get(index)).filter(Boolean);
  for (const mesh of meshes) mesh.scale.setScalar(1.08);
  await wait(Math.max(20, Number(speedRange.value) * 0.45));
  puzzle.applyMove(resolved);
  updateStickerColors(resolved.cycle);
  for (const mesh of meshes) mesh.scale.setScalar(1);
  await wait(Math.max(20, Number(speedRange.value) * 0.55));
}

function updateStickerColors(indexes = Array.from(stickerMeshes.keys())) {
  for (const index of indexes) {
    const mesh = stickerMeshes.get(index);
    if (!mesh) continue;
    mesh.material.color.setHex(COLOR_HEX[colorCodeToName(puzzle.colors[index])] || COLOR_HEX.white);
  }
}

function runScramble() {
  const lengthByLayout = { A: 12, B: 12, C: 12, D: 8, E: 8, F: 8 };
  const seed = Math.floor(Math.random() * 0xffffffff);
  const moves = deterministicSkimmiqScramble(puzzle, lengthByLayout[puzzle.layout.id] || 8, seed);
  runSequence(moves, "Scrambling", {
    finalProgress: { text: "Ready", meta: "0 states" }
  });
}

async function runSolver() {
  if (busy) return;
  if (puzzle.isSolved()) {
    solverLabel.textContent = "Solved";
    return;
  }

  busy = true;
  setControlsDisabled(true);
  solverLabel.textContent = "Searching";
  setSolverProgress("Start", "0 states");
  try {
    const result = await solveInWorker();
    if (result.status !== "solved") {
      const label = result.status === "timeout" ? "Timed out" : "Not solved";
      solverLabel.textContent = label;
      setSolverProgress(label, `${formatCount(result.nodes || 0)} states · ${formatTime(result.elapsedMs || 0)}`);
      return;
    }

    renderMoveLog(`solve: ${result.text}`);
    setSolverProgress(
      solverMethodLabel(result.method),
      `${result.moves.length} moves · ${formatCount(result.nodes)} states · ${formatTime(result.elapsedMs)}`
    );
    busy = false;
    await runSequence(result.moves, `${result.moves.length} moves`, { log: false });
    solverLabel.textContent = `${result.moves.length} moves`;
  } catch (error) {
    console.error(error);
    solverLabel.textContent = "Solver error";
  } finally {
    busy = false;
    setControlsDisabled(false);
    updateLabels();
  }
}

function solveInWorker() {
  if (!worker) {
    worker = new Worker(new URL("./skimmiq-worker.js", import.meta.url), { type: "module" });
  }

  return new Promise((resolve, reject) => {
    const handleMessage = (event) => {
      const message = event.data;
      if (message.type === "progress") {
        const formatted = formatSolverProgress(message.progress);
        solverLabel.textContent = formatted.label;
        setSolverProgress(formatted.detail, formatted.meta);
        return;
      }
      worker.removeEventListener("message", handleMessage);
      if (message.type === "result") resolve(message.result);
      else reject(new Error(message.error || "Solver worker failed."));
    };

    worker.addEventListener("message", handleMessage);
    worker.postMessage({
      type: "solve",
      state: puzzle.toJSON(),
      timeoutMs: 0,
      maxDepth: 42,
      beamWidth: 2600
    });
  });
}

function resetPuzzle() {
  if (busy) return;
  puzzle.reset();
  history = [];
  lastMove = null;
  updateStickerColors();
  renderMoveLog();
  updateLabels();
  solverLabel.textContent = "Ready";
  setSolverProgress("Ready", "0 states");
}

function updateLabels() {
  stateLabel.textContent = puzzle.isSolved() ? "Solved" : "In progress";
  layoutLabel.textContent = puzzle.layout.title;
  difficultyLabel.textContent = puzzle.difficulty.label;
  moveLabel.textContent = `${puzzle.tapes.length} tapes`;

  for (const button of layoutControls.querySelectorAll("button")) {
    button.classList.toggle("is-selected", button.textContent === puzzle.layout.label);
  }
  for (const button of difficultyControls.querySelectorAll("button")) {
    button.classList.toggle("is-selected", button.textContent === puzzle.difficulty.label);
  }
  for (const button of moveControls.querySelectorAll("button")) {
    button.classList.toggle(
      "is-active",
      lastMove && button.dataset.move === skimmiqMoveToString(lastMove)
    );
  }
}

function renderMoveLog(prefix = "") {
  if (prefix) {
    moveLog.textContent = prefix;
    return;
  }
  moveLog.textContent = history.length ? skimmiqMovesToString(history) : "-";
}

function setSolverProgress(text, meta) {
  progressText.textContent = text;
  progressMeta.textContent = meta;
}

function solverMethodLabel(method) {
  if (method === "meet-in-the-middle") return "Exact MITM";
  if (method === "rust-wasm-mitm") return "Rust WASM MITM";
  if (method === "rust-wasm-macro") return "Rust WASM macros";
  if (method === "macro-commutator") return "Macros solved";
  return "Beam solved";
}

function formatSolverProgress(progress) {
  const depth = Number.isInteger(progress.depth) ? progress.depth : 0;
  if (progress.phase === "table-build") {
    return {
      label: `Table d${depth + 1}`,
      detail: "Building table",
      meta: progressMetaText(progress)
    };
  }
  if (progress.phase === "table-ready") {
    return {
      label: "Table ready",
      detail: "Exact database",
      meta: progressMetaText(progress)
    };
  }
  if (progress.phase === "exact-forward") {
    return {
      label: `MITM d${depth + 1}`,
      detail: "Joining database",
      meta: progressMetaText(progress)
    };
  }
  if (progress.phase === "guided-beam") {
    const restart = Number.isInteger(progress.restart) ? progress.restart + 1 : 1;
    return {
      label: `Beam r${restart} d${depth + 1}`,
      detail: progress.bestScore === 0 ? "Closing" : `Best ${Math.round(progress.bestScore || 0)}`,
      meta: progressMetaText(progress)
    };
  }
  if (progress.phase === "macro-beam") {
    const tier = Number.isInteger(progress.tier) ? progress.tier + 1 : 1;
    const restart = Number.isInteger(progress.restart) ? progress.restart + 1 : 1;
    return {
      label: `Macro t${tier} r${restart} d${depth + 1}`,
      detail: progress.bestScore === 0 ? "Closing" : `Best ${Math.round(progress.bestScore || 0)}`,
      meta: progressMetaText(progress)
    };
  }
  if (progress.phase === "wasm-solve") {
    return {
      label: "Rust WASM",
      detail: "Native solver",
      meta: progressMetaText(progress)
    };
  }
  if (progress.phase === "js-fallback") {
    return {
      label: "JS fallback",
      detail: "Continuing in JavaScript",
      meta: progressMetaText(progress)
    };
  }
  return {
    label: "Solver",
    detail: "Working",
    meta: progressMetaText(progress)
  };
}

function progressMetaText(progress) {
  const parts = [];
  if (Number.isFinite(progress.nodes)) parts.push(`${formatCount(progress.nodes)} states`);
  if (Number.isFinite(progress.frontier)) parts.push(`${formatCount(progress.frontier)} front`);
  if (Number.isFinite(progress.tableSize)) parts.push(`${formatCount(progress.tableSize)} db`);
  if (Number.isFinite(progress.elapsedMs)) parts.push(formatTime(progress.elapsedMs));
  return parts.join(" · ") || "0 states";
}

function formatCount(value) {
  return Math.max(0, Number(value) || 0).toLocaleString("pl-PL");
}

function formatTime(ms) {
  const seconds = Math.max(0, Number(ms) || 0) / 1000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function setControlsDisabled(disabled) {
  for (const element of document.querySelectorAll("button, input")) {
    element.disabled = disabled;
  }
}

function resize() {
  const { width, height } = canvas.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);

  const maxDimension = Math.max(puzzle.layout.rows, puzzle.layout.cols, puzzle.layout.layers);
  const nextLayoutMode = width < 620 ? "compact" : "wide";
  if (nextLayoutMode !== layoutMode) {
    const mobileBoost = nextLayoutMode === "compact" ? 1.38 : 1;
    const distance = (4.4 + maxDimension * 0.92) * mobileBoost;
    camera.position.set(distance * 0.62, distance * 0.5, distance);
    controls.minDistance = Math.max(3.6, distance * 0.55);
    controls.maxDistance = distance * 1.8;
    controls.target.set(0, 0, 0);
    layoutMode = nextLayoutMode;
  }

  camera.updateProjectionMatrix();
}

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function centerCoordinate(index, count) {
  return (index - (count - 1) / 2) * SKIMMIQ_CELL_SPACING;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

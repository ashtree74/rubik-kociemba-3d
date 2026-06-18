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
const SKIMMIQ_STICKER_CLEARANCE = 0.004;
const SKIMMIQ_BEND_COLUMNS = 18;
const SKIMMIQ_BEND_ROWS = 3;
const SKIMMIQ_SURFACE_GAP = SKIMMIQ_STICKER_DEPTH / 2 + SKIMMIQ_STICKER_CLEARANCE + 0.004;
const stickerGeometry = new RoundedBoxGeometry(
  SKIMMIQ_STICKER_SIZE,
  SKIMMIQ_STICKER_SIZE,
  SKIMMIQ_STICKER_DEPTH,
  5,
  0.026
);

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
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 4;
controls.maxDistance = 13;
controls.target.set(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0xded3bd, 2.75));
const key = new THREE.DirectionalLight(0xffffff, 3.4);
key.position.set(4.5, 6, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.00012;
key.shadow.normalBias = 0.045;
scene.add(key);
const fill = new THREE.DirectionalLight(0x40dff4, 1.2);
fill.position.set(-5, 2, -4);
scene.add(fill);
const lowerFill = new THREE.DirectionalLight(0xfff0b8, 0.9);
lowerFill.position.set(-2, -4, 3);
scene.add(lowerFill);

const group = new THREE.Group();
scene.add(group);

let puzzle = new SkimmiqPuzzle("E", "classic");
let selectedLayoutId = "E";
let selectedDifficultyId = "classic";
let stickerMeshes = new Map();
let stickerTiles = new Map();
let stickerSlots = new Map();
let busy = false;
let worker = null;
let history = [];
let lastMove = null;
let layoutMode = "";
let activeBodyDimensions = getBodyDimensions(puzzle.layout);
let activeBodyRadius = bodyRadiusForDimensions(activeBodyDimensions);

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
  stickerTiles = new Map();
  stickerSlots = new Map();

  activeBodyDimensions = getBodyDimensions(puzzle.layout);
  activeBodyRadius = bodyRadiusForDimensions(activeBodyDimensions);
  const bodyGeometry = new RoundedBoxGeometry(
    activeBodyDimensions.x,
    activeBodyDimensions.y,
    activeBodyDimensions.z,
    8,
    activeBodyRadius
  );
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x111119,
    roughness: 0.64,
    metalness: 0.04
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  for (let index = 0; index < puzzle.stickers.length; index += 1) {
    const sticker = puzzle.stickers[index];
    const slot = getStickerSlot(sticker, puzzle.layout, activeBodyDimensions);
    const tile = new THREE.Group();
    tile.position.copy(slot.position);
    tile.quaternion.copy(slot.quaternion);

    const mesh = createStickerMesh(puzzle.colors[index]);
    mesh.userData = { stickerIndex: index, sticker };
    tile.add(mesh);

    stickerMeshes.set(index, mesh);
    stickerTiles.set(index, tile);
    stickerSlots.set(index, slot);
    group.add(tile);
  }
}

function createStickerMesh(colorCode, geometry = stickerGeometry) {
  const color = COLOR_HEX[colorCodeToName(colorCode)] || COLOR_HEX.white;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.43,
    metalness: 0,
    emissive: color,
    emissiveIntensity: 0.12
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function getBodyDimensions(layout) {
  return new THREE.Vector3(
    bodySpan(layout.rows),
    bodySpan(layout.cols),
    bodySpan(layout.layers)
  );
}

function bodySpan(count) {
  return (count - 1) * SKIMMIQ_CELL_SPACING + SKIMMIQ_BODY_SIZE;
}

function bodyRadiusForDimensions(dimensions) {
  return Math.min(0.12, Math.min(dimensions.x, dimensions.y, dimensions.z) * 0.16);
}

function getStickerSlot(sticker, layout, bodyDimensions) {
  const axes = FACE_AXES[sticker.face];
  const basisMatrix = new THREE.Matrix4().makeBasis(axes.localX, axes.localY, axes.normal);
  const surfaceOffset = surfaceOffsetForFace(sticker.face, bodyDimensions);
  const position = new THREE.Vector3(
    axes.normal.x === 0 ? centerCoordinate(sticker.x, layout.rows) : axes.normal.x * surfaceOffset,
    axes.normal.y === 0 ? centerCoordinate(sticker.y, layout.cols) : axes.normal.y * surfaceOffset,
    axes.normal.z === 0 ? centerCoordinate(sticker.z, layout.layers) : axes.normal.z * surfaceOffset
  );

  return {
    face: sticker.face,
    normal: axes.normal.clone(),
    position,
    quaternion: new THREE.Quaternion().setFromRotationMatrix(basisMatrix)
  };
}

function surfaceOffsetForFace(face, bodyDimensions) {
  const normal = FACE_AXES[face].normal;
  const bodyDepth =
    Math.abs(normal.x) * bodyDimensions.x +
    Math.abs(normal.y) * bodyDimensions.y +
    Math.abs(normal.z) * bodyDimensions.z;
  return bodyDepth / 2 + SKIMMIQ_STICKER_DEPTH / 2 + SKIMMIQ_STICKER_CLEARANCE;
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
  await animateTapeMove(resolved, () => {
    puzzle.applyMove(resolved);
    updateStickerColors(resolved.cycle);
  });
}

async function animateTapeMove(resolved, finalize) {
  const affectedIndexes = resolved.cycle;
  const duration = Math.max(90, Number(speedRange.value) * 1.1);
  setStickerVisibility(affectedIndexes, false);
  const tokens = affectedIndexes.map((sourceIndex, cycleIndex) => {
    const targetCycleIndex =
      (cycleIndex + (resolved.direction > 0 ? 1 : -1) + affectedIndexes.length) % affectedIndexes.length;
    return createTapeToken(sourceIndex, affectedIndexes[targetCycleIndex]);
  });

  try {
    await animateTapeTokens(tokens, duration);
    finalize();
  } finally {
    for (const token of tokens) {
      group.remove(token.group);
      for (const mesh of token.meshes) mesh.material.dispose();
      if (token.geometry) token.geometry.dispose();
    }
    setStickerVisibility(affectedIndexes, true);
  }
}

function createTapeToken(sourceIndex, targetIndex) {
  const from = stickerSlots.get(sourceIndex);
  const to = stickerSlots.get(targetIndex);
  if (from.face !== to.face) return createBentTapeToken(sourceIndex, from, to);

  const groupToken = new THREE.Group();
  groupToken.position.copy(from.position);
  groupToken.quaternion.copy(from.quaternion);

  const mesh = createStickerMesh(puzzle.colors[sourceIndex]);
  groupToken.add(mesh);
  group.add(groupToken);

  return { from, group: groupToken, meshes: [mesh], to };
}

function createBentTapeToken(sourceIndex, from, to) {
  const groupToken = new THREE.Group();
  const edgeAxis = from.normal.clone().cross(to.normal);
  if (edgeAxis.lengthSq() < 0.01) edgeAxis.copy(FACE_AXES[from.face].localY);
  else edgeAxis.normalize();

  const towardTarget = to.position.clone().sub(from.position);
  let fromTangent = edgeAxis.clone().cross(from.normal).normalize();
  if (fromTangent.dot(towardTarget) < 0) {
    edgeAxis.negate();
    fromTangent = edgeAxis.clone().cross(from.normal).normalize();
  }
  const toTangent = edgeAxis.clone().cross(to.normal).normalize();
  const bend = createEdgeBend(from, to, edgeAxis, fromTangent, toTangent);

  const geometry = createBentStickerGeometry();
  const mesh = createStickerMesh(puzzle.colors[sourceIndex], geometry);
  mesh.material.side = THREE.DoubleSide;
  groupToken.add(mesh);
  group.add(groupToken);

  const token = { bend, edgeAxis, from, fromTangent, geometry, group: groupToken, meshes: [mesh], to, toTangent };
  setBentTapeTokenTransform(token, 0);
  return token;
}

function createEdgeBend(from, to, edgeAxis, fromTangent, toTangent) {
  const half = activeBodyDimensions.clone().multiplyScalar(0.5);
  const edgeRadius = activeBodyRadius + SKIMMIQ_SURFACE_GAP;
  const edgeCenter = new THREE.Vector3()
    .addScaledVector(from.normal, halfExtentForNormal(from.normal, half) - activeBodyRadius)
    .addScaledVector(to.normal, halfExtentForNormal(to.normal, half) - activeBodyRadius)
    .addScaledVector(edgeAxis, from.position.dot(edgeAxis));
  const edgeStart = edgeCenter.clone().addScaledVector(from.normal, edgeRadius);
  const edgeEnd = edgeCenter.clone().addScaledVector(to.normal, edgeRadius);
  const fromFlatLength = Math.max(0, edgeStart.clone().sub(from.position).dot(fromTangent));
  const toFlatLength = Math.max(0, to.position.clone().sub(edgeEnd).dot(toTangent));
  const arcLength = edgeRadius * Math.PI * 0.5;

  return {
    arcLength,
    edgeCenter,
    edgeEnd,
    edgeRadius,
    edgeStart,
    fromFlatLength,
    toFlatLength,
    totalLength: Math.max(0.001, fromFlatLength + arcLength + toFlatLength)
  };
}

function halfExtentForNormal(normal, half) {
  return Math.abs(normal.x) * half.x + Math.abs(normal.y) * half.y + Math.abs(normal.z) * half.z;
}

function createBentStickerGeometry() {
  const columns = SKIMMIQ_BEND_COLUMNS + 1;
  const rows = SKIMMIQ_BEND_ROWS + 1;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(columns * rows * 3);
  const normals = new Float32Array(columns * rows * 3);
  const uvs = new Float32Array(columns * rows * 2);
  const indices = [];

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const vertex = column * rows + row;
      uvs[vertex * 2] = column / SKIMMIQ_BEND_COLUMNS;
      uvs[vertex * 2 + 1] = row / SKIMMIQ_BEND_ROWS;
    }
  }

  for (let column = 0; column < SKIMMIQ_BEND_COLUMNS; column += 1) {
    for (let row = 0; row < SKIMMIQ_BEND_ROWS; row += 1) {
      const a = column * rows + row;
      const b = (column + 1) * rows + row;
      const c = (column + 1) * rows + row + 1;
      const d = column * rows + row + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function setStickerVisibility(indexes, visible) {
  for (const index of indexes) {
    const tile = stickerTiles.get(index);
    if (tile) tile.visible = visible;
  }
}

function animateTapeTokens(tokens, duration) {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = easeInOutCubic(progress);
      for (const token of tokens) setTapeTokenTransform(token, eased);
      if (progress < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

function setTapeTokenTransform(token, eased) {
  if (token.geometry) {
    setBentTapeTokenTransform(token, eased);
    return;
  }

  token.group.position.copy(token.from.position).lerp(token.to.position, eased);
  token.group.quaternion.copy(token.from.quaternion).slerp(token.to.quaternion, eased);
  token.group.scale.setScalar(1);
}

function setBentTapeTokenTransform(token, eased) {
  token.group.position.set(0, 0, 0);
  token.group.quaternion.identity();
  token.group.scale.setScalar(1);

  const positions = token.geometry.attributes.position.array;
  const normals = token.geometry.attributes.normal.array;
  const rows = SKIMMIQ_BEND_ROWS + 1;
  const bendSpan = SKIMMIQ_STICKER_SIZE / token.bend.totalLength;

  for (let column = 0; column <= SKIMMIQ_BEND_COLUMNS; column += 1) {
    const columnRatio = column / SKIMMIQ_BEND_COLUMNS;
    const pathSample = eased + (columnRatio - 0.5) * bendSpan;
    const frame = sampleBentTapeFrame(token, pathSample);

    for (let row = 0; row <= SKIMMIQ_BEND_ROWS; row += 1) {
      const rowOffset = (row / SKIMMIQ_BEND_ROWS - 0.5) * SKIMMIQ_STICKER_SIZE;
      const vertex = column * rows + row;
      const position = frame.position.clone().addScaledVector(frame.localY, rowOffset);

      positions[vertex * 3] = position.x;
      positions[vertex * 3 + 1] = position.y;
      positions[vertex * 3 + 2] = position.z;
      normals[vertex * 3] = frame.normal.x;
      normals[vertex * 3 + 1] = frame.normal.y;
      normals[vertex * 3 + 2] = frame.normal.z;
    }
  }

  token.geometry.attributes.position.needsUpdate = true;
  token.geometry.attributes.normal.needsUpdate = true;
  token.geometry.computeBoundingSphere();
}

function sampleBentTapeFrame(token, sample) {
  const bend = token.bend;
  const distance = sample * bend.totalLength;
  if (distance <= 0) {
    return {
      localY: token.edgeAxis,
      normal: token.from.normal,
      position: token.from.position.clone().addScaledVector(token.fromTangent, distance)
    };
  }
  if (distance <= bend.fromFlatLength) {
    return {
      localY: token.edgeAxis,
      normal: token.from.normal,
      position: token.from.position.clone().addScaledVector(token.fromTangent, distance)
    };
  }

  const arcDistance = distance - bend.fromFlatLength;
  if (arcDistance <= bend.arcLength) {
    const angle = arcDistance / bend.edgeRadius;
    const normal = token.from.normal
      .clone()
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(token.to.normal, Math.sin(angle))
      .normalize();
    return {
      localY: token.edgeAxis,
      normal,
      position: bend.edgeCenter.clone().addScaledVector(normal, bend.edgeRadius)
    };
  }

  const targetDistance = distance - bend.fromFlatLength - bend.arcLength;
  if (targetDistance <= bend.toFlatLength) {
    return {
      localY: token.edgeAxis,
      normal: token.to.normal,
      position: bend.edgeEnd.clone().addScaledVector(token.toTangent, targetDistance)
    };
  }

  return {
    localY: token.edgeAxis,
    normal: token.to.normal,
    position: token.to.position.clone().addScaledVector(token.toTangent, distance - bend.totalLength)
  };
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function updateStickerColors(indexes = Array.from(stickerMeshes.keys())) {
  for (const index of indexes) {
    const mesh = stickerMeshes.get(index);
    if (!mesh) continue;
    const color = COLOR_HEX[colorCodeToName(puzzle.colors[index])] || COLOR_HEX.white;
    mesh.material.color.setHex(color);
    mesh.material.emissive.setHex(color);
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
      timeoutMs: 0
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
  return "Rust WASM";
}

function formatSolverProgress(progress) {
  if (progress.phase === "wasm-solve") {
    return {
      label: "Rust WASM",
      detail: "Native solver",
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

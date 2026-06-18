import "./styles.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CubieCube,
  FACE_ORDER,
  MOVE_NAMES,
  moveToString,
  movesToString,
  parseMoveName
} from "./cube.js";

const canvas = document.querySelector("#cubeCanvas");
const stateLabel = document.querySelector("#stateLabel");
const solverLabel = document.querySelector("#solverLabel");
const selectedFaceLabel = document.querySelector("#selectedFaceLabel");
const movesGrid = document.querySelector("#movesGrid");
const moveLog = document.querySelector("#moveLog");
const scrambleBtn = document.querySelector("#scrambleBtn");
const solveBtn = document.querySelector("#solveBtn");
const resetBtn = document.querySelector("#resetBtn");
const clearLogBtn = document.querySelector("#clearLogBtn");
const turnCcwBtn = document.querySelector("#turnCcwBtn");
const turnHalfBtn = document.querySelector("#turnHalfBtn");
const turnCwBtn = document.querySelector("#turnCwBtn");
const speedRange = document.querySelector("#speedRange");

const FACE_COLORS = {
  U: 0xf8fafc,
  D: 0xffd84d,
  F: 0x13b66b,
  B: 0x2563eb,
  R: 0xe83b3b,
  L: 0xff8a30
};

const FACE_NORMALS = {
  U: new THREE.Vector3(0, 1, 0),
  D: new THREE.Vector3(0, -1, 0),
  F: new THREE.Vector3(0, 0, 1),
  B: new THREE.Vector3(0, 0, -1),
  R: new THREE.Vector3(1, 0, 0),
  L: new THREE.Vector3(-1, 0, 0)
};

const FACE_ROTATION = {
  U: { axis: "y", layer: 1, sign: -1 },
  D: { axis: "y", layer: -1, sign: 1 },
  R: { axis: "x", layer: 1, sign: -1 },
  L: { axis: "x", layer: -1, sign: 1 },
  F: { axis: "z", layer: 1, sign: -1 },
  B: { axis: "z", layer: -1, sign: 1 }
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3f1ea);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(5.2, 4.2, 6.6);

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
controls.minDistance = 5.5;
controls.maxDistance = 11;
controls.enablePan = false;
controls.target.set(0, 0, 0);

const hemi = new THREE.HemisphereLight(0xffffff, 0xc9b99d, 2.6);
scene.add(hemi);

const keyLight = new THREE.DirectionalLight(0xffffff, 4.2);
keyLight.position.set(3.5, 6, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x82c4ff, 1.2);
fillLight.position.set(-5, 2, -3);
scene.add(fillLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(13, 13),
  new THREE.ShadowMaterial({ color: 0x7a715e, opacity: 0.18 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -2.15;
floor.receiveShadow = true;
scene.add(floor);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const cubelets = [];
const stickers = [];
const pivot = new THREE.Group();
scene.add(pivot);

let cubeState = CubieCube.identity();
let selectedFace = "F";
let busy = false;
let moveHistory = [];
let solverWorker = null;
let workerRequestId = 0;
let layoutMode = "";

createMoveButtons();
buildVisualCube();
updateLabels();
resize();
animate();

window.addEventListener("resize", resize);
scrambleBtn.addEventListener("click", () => runScramble());
solveBtn.addEventListener("click", () => runSolver());
resetBtn.addEventListener("click", () => resetCube());
clearLogBtn.addEventListener("click", () => {
  moveHistory = [];
  renderMoveLog();
});
turnCcwBtn.addEventListener("click", () => runMove(parseMoveName(`${selectedFace}'`)));
turnHalfBtn.addEventListener("click", () => runMove(parseMoveName(`${selectedFace}2`)));
turnCwBtn.addEventListener("click", () => runMove(parseMoveName(selectedFace)));

let pointerDown = null;
canvas.addEventListener("pointerdown", (event) => {
  pointerDown = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener("pointerup", (event) => {
  if (!pointerDown) return;
  const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  pointerDown = null;
  if (distance < 6) selectFaceFromPointer(event);
});

window.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || busy) return;
  const face = event.key.toUpperCase();
  if (!FACE_ORDER.includes(face)) return;
  const suffix = event.shiftKey ? "'" : "";
  event.preventDefault();
  selectedFace = face;
  updateLabels();
  runMove(parseMoveName(`${face}${suffix}`));
});

function createMoveButtons() {
  for (const move of MOVE_NAMES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = move;
    button.dataset.move = move;
    button.addEventListener("click", () => runMove(parseMoveName(move)));
    movesGrid.appendChild(button);
  }
}

function buildVisualCube() {
  for (const cubelet of cubelets) scene.remove(cubelet);
  cubelets.length = 0;
  stickers.length = 0;

  const bodyGeometry = new THREE.BoxGeometry(0.94, 0.94, 0.94);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x141414,
    roughness: 0.72,
    metalness: 0.02
  });
  const stickerGeometry = new THREE.PlaneGeometry(0.72, 0.72);

  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        if (x === 0 && y === 0 && z === 0) continue;
        const group = new THREE.Group();
        group.position.set(x * 1.03, y * 1.03, z * 1.03);
        group.userData.coord = { x, y, z };

        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        if (y === 1) addSticker(group, stickerGeometry, "U");
        if (y === -1) addSticker(group, stickerGeometry, "D");
        if (z === 1) addSticker(group, stickerGeometry, "F");
        if (z === -1) addSticker(group, stickerGeometry, "B");
        if (x === 1) addSticker(group, stickerGeometry, "R");
        if (x === -1) addSticker(group, stickerGeometry, "L");

        scene.add(group);
        cubelets.push(group);
      }
    }
  }
}

function addSticker(group, geometry, face) {
  const normal = FACE_NORMALS[face];
  const material = new THREE.MeshStandardMaterial({
    color: FACE_COLORS[face],
    roughness: 0.48,
    metalness: 0,
    side: THREE.DoubleSide
  });
  const sticker = new THREE.Mesh(geometry, material);
  sticker.position.copy(normal).multiplyScalar(0.476);
  sticker.userData.face = face;
  sticker.userData.isSticker = true;

  if (Math.abs(normal.y) === 1) {
    sticker.rotation.x = normal.y > 0 ? -Math.PI / 2 : Math.PI / 2;
  } else if (Math.abs(normal.x) === 1) {
    sticker.rotation.y = normal.x > 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  sticker.castShadow = false;
  group.add(sticker);
  stickers.push(sticker);
}

async function runMove(moveIndex, options = {}) {
  if (busy) return;
  busy = true;
  setControlsDisabled(true);
  try {
    await applyVisualMove(moveIndex);
    cubeState.applyMove(moveIndex);
    if (options.log !== false) {
      moveHistory.push(moveIndex);
      renderMoveLog();
    }
    selectedFace = FACE_ORDER[Math.floor(moveIndex / 3)];
    updateLabels();
  } finally {
    busy = false;
    setControlsDisabled(false);
  }
}

async function runSequence(moves, label, options = {}) {
  if (busy) return;
  busy = true;
  setControlsDisabled(true);
  solverLabel.textContent = label;
  try {
    for (const moveIndex of moves) {
      await applyVisualMove(moveIndex);
      cubeState.applyMove(moveIndex);
      if (options.log !== false) moveHistory.push(moveIndex);
      selectedFace = FACE_ORDER[Math.floor(moveIndex / 3)];
      renderMoveLog();
      updateLabels();
    }
  } finally {
    busy = false;
    solverLabel.textContent = "Ready";
    setControlsDisabled(false);
  }
}

function applyVisualMove(moveIndex) {
  const face = FACE_ORDER[Math.floor(moveIndex / 3)];
  const power = (moveIndex % 3) + 1;
  const config = FACE_ROTATION[face];
  const selected = cubelets.filter((cubelet) => {
    const layerValue = Math.round(cubelet.position[config.axis] / 1.03);
    return layerValue === config.layer;
  });

  const turns = power === 3 ? -1 : power;
  const targetAngle = config.sign * turns * (Math.PI / 2);
  const duration = Number(speedRange.value);
  const startedAt = performance.now();

  pivot.rotation.set(0, 0, 0);
  pivot.updateMatrixWorld(true);
  for (const cubelet of selected) pivot.attach(cubelet);

  return new Promise((resolve) => {
    const tick = () => {
      const t = Math.min(1, (performance.now() - startedAt) / duration);
      const eased = easeInOutCubic(t);
      pivot.rotation[config.axis] = targetAngle * eased;
      if (t < 1) {
        requestAnimationFrame(tick);
        return;
      }
      pivot.updateMatrixWorld(true);
      for (const cubelet of selected) {
        scene.attach(cubelet);
        snapCubelet(cubelet);
      }
      pivot.rotation.set(0, 0, 0);
      resolve();
    };
    requestAnimationFrame(tick);
  });
}

function snapCubelet(cubelet) {
  cubelet.position.set(
    Math.round(cubelet.position.x / 1.03) * 1.03,
    Math.round(cubelet.position.y / 1.03) * 1.03,
    Math.round(cubelet.position.z / 1.03) * 1.03
  );
  cubelet.userData.coord = {
    x: Math.round(cubelet.position.x / 1.03),
    y: Math.round(cubelet.position.y / 1.03),
    z: Math.round(cubelet.position.z / 1.03)
  };
}

function runScramble() {
  const scramble = [];
  let lastFace = -1;
  let lastAxis = -1;
  while (scramble.length < 25) {
    const face = Math.floor(Math.random() * 6);
    const axis = face % 3;
    if (face === lastFace || axis === lastAxis) continue;
    const power = Math.floor(Math.random() * 3);
    scramble.push(face * 3 + power);
    lastFace = face;
    lastAxis = axis;
  }
  runSequence(scramble, "Scrambling");
}

async function runSolver() {
  if (busy) return;
  if (cubeState.isSolved()) {
    solverLabel.textContent = "Solved";
    return;
  }

  busy = true;
  setControlsDisabled(true);
  solverLabel.textContent = "Initializing";

  try {
    const result = await solveInWorker(cubeState);
    if (!result?.moves) {
      solverLabel.textContent = "No solution";
      return;
    }

    const solutionText = result.text || movesToString(result.moves);
    moveHistory.push(...result.moves);
    renderMoveLog(`solve: ${solutionText}`);
    busy = false;
    await runSequence(result.moves, `Solving ${result.moves.length}`, { log: false });
    solverLabel.textContent = `${result.moves.length} moves`;
  } catch (error) {
    solverLabel.textContent = "Solver error";
    console.error(error);
  } finally {
    busy = false;
    setControlsDisabled(false);
    updateLabels();
  }
}

function solveInWorker(cube) {
  const requestId = workerRequestId + 1;
  workerRequestId = requestId;
  if (!solverWorker) {
    solverWorker = new Worker(new URL("./solver-worker.js", import.meta.url), { type: "module" });
  }

  return new Promise((resolve, reject) => {
    const handleMessage = (event) => {
      const message = event.data;
      if (message.type === "progress") {
        solverLabel.textContent = `${message.progress.label}`;
        return;
      }
      if (message.type === "search") {
        solverLabel.textContent = `Searching d${message.search.depth}`;
        return;
      }
      solverWorker.removeEventListener("message", handleMessage);
      if (message.type === "solution") {
        resolve(message.result);
      } else if (message.type === "failed") {
        reject(new Error(message.reason));
      } else if (message.type === "error") {
        reject(new Error(message.error));
      }
    };

    solverWorker.addEventListener("message", handleMessage);
    solverWorker.postMessage({
      type: "solve",
      requestId,
      cube: cube.toJSON(),
      maxDepth: 30,
      timeoutMs: 60000
    });
  });
}

function resetCube() {
  if (busy) return;
  cubeState = CubieCube.identity();
  moveHistory = [];
  buildVisualCube();
  solverLabel.textContent = "Ready";
  renderMoveLog();
  updateLabels();
}

function selectFaceFromPointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(stickers, false);
  if (!hits.length) return;
  selectedFace = hits[0].object.userData.face;
  updateLabels();
}

function updateLabels() {
  stateLabel.textContent = cubeState.isSolved() ? "Solved" : "In progress";
  selectedFaceLabel.textContent = `Selected: ${selectedFace}`;
  for (const button of movesGrid.querySelectorAll("button")) {
    button.classList.toggle("is-selected", button.dataset.move?.startsWith(selectedFace));
  }
}

function renderMoveLog(prefix = "") {
  if (prefix) {
    moveLog.textContent = prefix;
    return;
  }
  moveLog.textContent = moveHistory.length ? moveHistory.map(moveToString).join(" ") : "-";
}

function setControlsDisabled(disabled) {
  for (const element of document.querySelectorAll("button, input")) {
    element.disabled = disabled;
  }
}

function resize() {
  const { width, height } = canvas.getBoundingClientRect();
  camera.aspect = width / Math.max(1, height);
  const nextLayoutMode = width < 620 ? "compact" : "wide";
  if (nextLayoutMode !== layoutMode) {
    if (nextLayoutMode === "compact") {
      camera.position.set(6.5, 5.1, 9.2);
      controls.minDistance = 7.2;
      controls.maxDistance = 14;
      controls.target.set(0, 0.22, 0);
    } else {
      camera.position.set(5.2, 4.2, 6.6);
      controls.minDistance = 5.5;
      controls.maxDistance = 11;
      controls.target.set(0, 0, 0);
    }
    layoutMode = nextLayoutMode;
  }
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

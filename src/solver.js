import {
  CubieCube,
  FACE_AXIS,
  MOVE_CUBES,
  MOVE_FACE,
  movesToString
} from "./cube.js";

const TWIST_COUNT = 2187;
const FLIP_COUNT = 2048;
const SLICE_COUNT = 495;
const CORNER_PERM_COUNT = 40320;
const UD_EDGE_PERM_COUNT = 40320;
const SLICE_PERM_COUNT = 24;
const PHASE1_MOVE_COUNT = 18;
const PHASE2_MOVES = Object.freeze([0, 1, 2, 4, 7, 9, 10, 11, 13, 16]);
const PHASE2_MOVE_COUNT = PHASE2_MOVES.length;
const FACT = Object.freeze([1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880]);

const SLICE_MASKS = buildSliceMasks();
const SLICE_INDEX_BY_MASK = buildSliceIndexMap(SLICE_MASKS);

export class KociembaSolver {
  constructor() {
    this.tables = null;
    this.initializing = null;
    this.nodes = 0;
    this.phase2Attempts = 0;
  }

  async initialize(onProgress = () => {}) {
    if (this.tables) return this.tables;
    if (!this.initializing) {
      this.initializing = Promise.resolve().then(() => {
        this.tables = buildTables(onProgress);
        return this.tables;
      });
    }
    return this.initializing;
  }

  async solve(cube, options = {}) {
    const tables = await this.initialize(options.onProgress);
    return this.solveWithTables(cube, tables, options);
  }

  solveWithTables(cube, tables, options = {}) {
    const validation = cube.validate();
    if (!validation.ok) {
      throw new Error(validation.errors.join(" "));
    }
    if (cube.isSolved()) {
      return {
        moves: [],
        text: "",
        nodes: 0,
        phase2Attempts: 0,
        elapsedMs: 0
      };
    }

    const startedAt = performanceNow();
    const deadline = startedAt + (options.timeoutMs ?? 45000);
    const maxDepth = options.maxDepth ?? 30;
    const maxPhase1Depth = options.maxPhase1Depth ?? 12;

    this.nodes = 0;
    this.phase2Attempts = 0;

    const twist = getTwist(cube);
    const flip = getFlip(cube);
    const slice = getSlice(cube);
    const phase1LowerBound = phase1Heuristic(tables, twist, flip, slice);
    const path = [];

    for (let depth = phase1LowerBound; depth <= maxPhase1Depth; depth += 1) {
      options.onSearch?.({
        phase: "phase1",
        depth,
        nodes: this.nodes,
        phase2Attempts: this.phase2Attempts
      });
      const result = this.searchPhase1(
        cube,
        tables,
        twist,
        flip,
        slice,
        depth,
        -1,
        path,
        maxDepth,
        deadline
      );
      if (result) {
        return {
          moves: result,
          text: movesToString(result),
          nodes: this.nodes,
          phase2Attempts: this.phase2Attempts,
          elapsedMs: Math.round(performanceNow() - startedAt)
        };
      }
    }

    return null;
  }

  searchPhase1(rootCube, tables, twist, flip, slice, depth, lastFace, path, maxDepth, deadline) {
    this.checkDeadline(deadline);
    this.nodes += 1;

    if (phase1Heuristic(tables, twist, flip, slice) > depth) return null;

    if (depth === 0) {
      if (twist !== 0 || flip !== 0 || slice !== 0) return null;
      const middleCube = rootCube.clone().applyMoves(path);
      const phase2MaxDepth = maxDepth - path.length;
      if (phase2MaxDepth < 0) return null;

      this.phase2Attempts += 1;
      const phase2 = this.solvePhase2(middleCube, tables, phase2MaxDepth, lastFace, deadline);
      return phase2 ? path.concat(phase2) : null;
    }

    for (let move = 0; move < PHASE1_MOVE_COUNT; move += 1) {
      const face = MOVE_FACE[move];
      if (isRedundantMove(face, lastFace)) continue;

      const nextTwist = tables.twistMove[twist * PHASE1_MOVE_COUNT + move];
      const nextFlip = tables.flipMove[flip * PHASE1_MOVE_COUNT + move];
      const nextSlice = tables.sliceMove[slice * PHASE1_MOVE_COUNT + move];
      path.push(move);
      const result = this.searchPhase1(
        rootCube,
        tables,
        nextTwist,
        nextFlip,
        nextSlice,
        depth - 1,
        face,
        path,
        maxDepth,
        deadline
      );
      if (result) return result;
      path.pop();
    }

    return null;
  }

  solvePhase2(cube, tables, maxDepth, lastPhase1Face, deadline) {
    const cornerPerm = getCornerPerm(cube);
    const edgePerm = getUDEdgePerm(cube);
    const slicePerm = getSlicePerm(cube);
    const lowerBound = phase2Heuristic(tables, cornerPerm, edgePerm, slicePerm);
    const path = [];

    for (let depth = lowerBound; depth <= maxDepth; depth += 1) {
      if (this.searchPhase2(
        tables,
        cornerPerm,
        edgePerm,
        slicePerm,
        depth,
        lastPhase1Face,
        path,
        deadline
      )) {
        return path.slice();
      }
    }
    return null;
  }

  searchPhase2(tables, cornerPerm, edgePerm, slicePerm, depth, lastFace, path, deadline) {
    this.checkDeadline(deadline);
    this.nodes += 1;

    if (phase2Heuristic(tables, cornerPerm, edgePerm, slicePerm) > depth) return false;
    if (depth === 0) {
      return cornerPerm === 0 && edgePerm === 0 && slicePerm === 0;
    }

    for (let column = 0; column < PHASE2_MOVE_COUNT; column += 1) {
      const move = PHASE2_MOVES[column];
      const face = MOVE_FACE[move];
      if (isRedundantMove(face, lastFace)) continue;

      const nextCorner = tables.cornerPermMove[cornerPerm * PHASE2_MOVE_COUNT + column];
      const nextEdge = tables.udEdgePermMove[edgePerm * PHASE2_MOVE_COUNT + column];
      const nextSlice = tables.slicePermMove[slicePerm * PHASE2_MOVE_COUNT + column];
      path.push(move);
      if (this.searchPhase2(
        tables,
        nextCorner,
        nextEdge,
        nextSlice,
        depth - 1,
        face,
        path,
        deadline
      )) {
        return true;
      }
      path.pop();
    }

    return false;
  }

  checkDeadline(deadline) {
    if ((this.nodes & 0x3fff) === 0 && performanceNow() > deadline) {
      throw new Error("Solver exceeded the time limit.");
    }
  }
}

export function buildTables(onProgress = () => {}) {
  const progress = (label, detail = "") => onProgress({ label, detail });

  progress("Move tables", "corner orientation");
  const twistMove = buildMoveTable(
    TWIST_COUNT,
    PHASE1_MOVE_COUNT,
    setTwist,
    getTwist
  );

  progress("Move tables", "edge orientation");
  const flipMove = buildMoveTable(
    FLIP_COUNT,
    PHASE1_MOVE_COUNT,
    setFlip,
    getFlip
  );

  progress("Move tables", "slice positions");
  const sliceMove = buildMoveTable(
    SLICE_COUNT,
    PHASE1_MOVE_COUNT,
    setSlice,
    getSlice
  );

  progress("Move tables", "corner permutations");
  const cornerPermMove = buildMoveTable(
    CORNER_PERM_COUNT,
    PHASE2_MOVE_COUNT,
    setCornerPerm,
    getCornerPerm,
    PHASE2_MOVES
  );

  progress("Move tables", "U/D edge permutations");
  const udEdgePermMove = buildMoveTable(
    UD_EDGE_PERM_COUNT,
    PHASE2_MOVE_COUNT,
    setUDEdgePerm,
    getUDEdgePerm,
    PHASE2_MOVES
  );

  progress("Move tables", "slice permutations");
  const slicePermMove = buildMoveTable(
    SLICE_PERM_COUNT,
    PHASE2_MOVE_COUNT,
    setSlicePerm,
    getSlicePerm,
    PHASE2_MOVES
  );

  progress("Pruning", "phase 1: twist + slice");
  const twistSlicePruning = buildPruningTable(
    TWIST_COUNT,
    SLICE_COUNT,
    twistMove,
    sliceMove,
    PHASE1_MOVE_COUNT,
    (depth, count, total) => progress("Pruning", `phase 1 twist/slice ${depth}: ${count}/${total}`)
  );

  progress("Pruning", "phase 1: flip + slice");
  const flipSlicePruning = buildPruningTable(
    FLIP_COUNT,
    SLICE_COUNT,
    flipMove,
    sliceMove,
    PHASE1_MOVE_COUNT,
    (depth, count, total) => progress("Pruning", `phase 1 flip/slice ${depth}: ${count}/${total}`)
  );

  progress("Pruning", "phase 2: corners + slice");
  const cornerSlicePruning = buildPruningTable(
    CORNER_PERM_COUNT,
    SLICE_PERM_COUNT,
    cornerPermMove,
    slicePermMove,
    PHASE2_MOVE_COUNT,
    (depth, count, total) => progress("Pruning", `phase 2 corners ${depth}: ${count}/${total}`)
  );

  progress("Pruning", "phase 2: edges + slice");
  const edgeSlicePruning = buildPruningTable(
    UD_EDGE_PERM_COUNT,
    SLICE_PERM_COUNT,
    udEdgePermMove,
    slicePermMove,
    PHASE2_MOVE_COUNT,
    (depth, count, total) => progress("Pruning", `phase 2 edges ${depth}: ${count}/${total}`)
  );

  progress("Gotowe", "solver zainicjalizowany");
  return {
    twistMove,
    flipMove,
    sliceMove,
    cornerPermMove,
    udEdgePermMove,
    slicePermMove,
    twistSlicePruning,
    flipSlicePruning,
    cornerSlicePruning,
    edgeSlicePruning
  };
}

export function getTwist(cube) {
  let value = 0;
  for (let i = 0; i < 7; i += 1) {
    value = value * 3 + cube.co[i];
  }
  return value;
}

export function setTwist(value) {
  const cube = CubieCube.identity();
  let sum = 0;
  for (let i = 6; i >= 0; i -= 1) {
    cube.co[i] = value % 3;
    sum += cube.co[i];
    value = Math.floor(value / 3);
  }
  cube.co[7] = (3 - (sum % 3)) % 3;
  return cube;
}

export function getFlip(cube) {
  let value = 0;
  for (let i = 0; i < 11; i += 1) {
    value = value * 2 + cube.eo[i];
  }
  return value;
}

export function setFlip(value) {
  const cube = CubieCube.identity();
  let sum = 0;
  for (let i = 10; i >= 0; i -= 1) {
    cube.eo[i] = value & 1;
    sum += cube.eo[i];
    value >>= 1;
  }
  cube.eo[11] = (2 - (sum % 2)) % 2;
  return cube;
}

export function getSlice(cube) {
  let mask = 0;
  for (let i = 0; i < 12; i += 1) {
    if (cube.ep[i] >= 8) mask |= 1 << i;
  }
  return SLICE_INDEX_BY_MASK[mask];
}

export function setSlice(value) {
  const cube = CubieCube.identity();
  const mask = SLICE_MASKS[value];
  let udEdge = 0;
  let sliceEdge = 8;
  for (let i = 0; i < 12; i += 1) {
    if (mask & (1 << i)) {
      cube.ep[i] = sliceEdge;
      sliceEdge += 1;
    } else {
      cube.ep[i] = udEdge;
      udEdge += 1;
    }
  }
  return cube;
}

export function getCornerPerm(cube) {
  return rankPermutation(cube.cp, 8);
}

export function setCornerPerm(value) {
  const cube = CubieCube.identity();
  cube.cp = unrankPermutation(value, 8);
  return cube;
}

export function getUDEdgePerm(cube) {
  return rankPermutation(cube.ep.slice(0, 8), 8);
}

export function setUDEdgePerm(value) {
  const cube = CubieCube.identity();
  const permutation = unrankPermutation(value, 8);
  for (let i = 0; i < 8; i += 1) {
    cube.ep[i] = permutation[i];
  }
  return cube;
}

export function getSlicePerm(cube) {
  const permutation = [
    cube.ep[8] - 8,
    cube.ep[9] - 8,
    cube.ep[10] - 8,
    cube.ep[11] - 8
  ];
  return rankPermutation(permutation, 4);
}

export function setSlicePerm(value) {
  const cube = CubieCube.identity();
  const permutation = unrankPermutation(value, 4);
  for (let i = 0; i < 4; i += 1) {
    cube.ep[8 + i] = 8 + permutation[i];
  }
  return cube;
}

function buildMoveTable(size, moveCount, setter, getter, moveIndexes = null) {
  const table = new Uint16Array(size * moveCount);
  for (let coordinate = 0; coordinate < size; coordinate += 1) {
    const cube = setter(coordinate);
    for (let column = 0; column < moveCount; column += 1) {
      const moveIndex = moveIndexes ? moveIndexes[column] : column;
      table[coordinate * moveCount + column] = getter(cube.clone().applyMove(moveIndex));
    }
  }
  return table;
}

function buildPruningTable(sizeA, sizeB, moveA, moveB, moveCount, onDepth) {
  const total = sizeA * sizeB;
  const pruning = new Int8Array(total);
  pruning.fill(-1);
  pruning[0] = 0;

  let frontier = new Uint32Array(total);
  let nextFrontier = new Uint32Array(total);
  let frontierSize = 1;
  let reached = 1;
  let depth = 0;
  frontier[0] = 0;

  while (reached < total) {
    let nextSize = 0;
    depth += 1;
    for (let cursor = 0; cursor < frontierSize; cursor += 1) {
      const index = frontier[cursor];
      const a = Math.floor(index / sizeB);
      const b = index - a * sizeB;
      const aOffset = a * moveCount;
      const bOffset = b * moveCount;

      for (let move = 0; move < moveCount; move += 1) {
        const nextA = moveA[aOffset + move];
        const nextB = moveB[bOffset + move];
        const nextIndex = nextA * sizeB + nextB;
        if (pruning[nextIndex] === -1) {
          pruning[nextIndex] = depth;
          nextFrontier[nextSize] = nextIndex;
          nextSize += 1;
          reached += 1;
        }
      }
    }

    const swap = frontier;
    frontier = nextFrontier;
    nextFrontier = swap;
    frontierSize = nextSize;
    onDepth?.(depth, reached, total);
  }

  return pruning;
}

function phase1Heuristic(tables, twist, flip, slice) {
  return Math.max(
    tables.twistSlicePruning[twist * SLICE_COUNT + slice],
    tables.flipSlicePruning[flip * SLICE_COUNT + slice]
  );
}

function phase2Heuristic(tables, cornerPerm, edgePerm, slicePerm) {
  return Math.max(
    tables.cornerSlicePruning[cornerPerm * SLICE_PERM_COUNT + slicePerm],
    tables.edgeSlicePruning[edgePerm * SLICE_PERM_COUNT + slicePerm]
  );
}

function rankPermutation(permutation, size) {
  let rank = 0;
  for (let i = 0; i < size; i += 1) {
    let smaller = 0;
    for (let j = i + 1; j < size; j += 1) {
      if (permutation[j] < permutation[i]) smaller += 1;
    }
    rank += smaller * FACT[size - 1 - i];
  }
  return rank;
}

function unrankPermutation(rank, size) {
  const elements = Array.from({ length: size }, (_, index) => index);
  const permutation = new Array(size);
  for (let i = 0; i < size; i += 1) {
    const factor = FACT[size - 1 - i];
    const selected = Math.floor(rank / factor);
    rank %= factor;
    permutation[i] = elements.splice(selected, 1)[0];
  }
  return permutation;
}

function buildSliceMasks() {
  const solvedMask = (1 << 8) | (1 << 9) | (1 << 10) | (1 << 11);
  const masks = [solvedMask];

  function visit(start, left, mask) {
    if (left === 0) {
      if (mask !== solvedMask) masks.push(mask);
      return;
    }
    for (let position = start; position <= 12 - left; position += 1) {
      visit(position + 1, left - 1, mask | (1 << position));
    }
  }

  visit(0, 4, 0);
  return masks;
}

function buildSliceIndexMap(masks) {
  const table = new Int16Array(1 << 12);
  table.fill(-1);
  masks.forEach((mask, index) => {
    table[mask] = index;
  });
  return table;
}

function isRedundantMove(face, lastFace) {
  if (lastFace < 0) return false;
  if (face === lastFace) return true;
  return FACE_AXIS[face] === FACE_AXIS[lastFace] && face < lastFace;
}

function performanceNow() {
  if (typeof performance !== "undefined" && performance.now) return performance.now();
  return Date.now();
}

export const solverInternals = {
  PHASE2_MOVES,
  getTwist,
  getFlip,
  getSlice,
  getCornerPerm,
  getUDEdgePerm,
  getSlicePerm,
  setTwist,
  setFlip,
  setSlice,
  setCornerPerm,
  setUDEdgePerm,
  setSlicePerm
};

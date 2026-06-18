import wasmUrl from "./wasm/skimmiq_solver.wasm?url";
import {
  SKIMMIQ_FACES,
  SkimmiqPuzzle,
  invertSkimmiqMove,
  skimmiqMovesToString
} from "./skimmiq-model.js";

const INPUT_MAGIC = 0x51494d53;
const OUTPUT_MAGIC = 0x524f4d53;
const STATUS_SOLVED = 1;
const METHOD_NAMES = {
  0: "rust-wasm-none",
  1: "rust-wasm-mitm",
  2: "rust-wasm-macro"
};

const TABLE_DEPTH_BY_LAYOUT = Object.freeze({
  A: 8,
  B: 8,
  C: 7,
  D: 6,
  E: 5,
  F: 5
});

const FORWARD_DEPTH_BY_LAYOUT = Object.freeze({
  A: 8,
  B: 8,
  C: 7,
  D: 6,
  E: 5,
  F: 5
});

let wasmPromise = null;

export async function solveSkimmiqWasm(state, options = {}) {
  const puzzle = SkimmiqPuzzle.fromJSON(state);
  const validation = puzzle.validate();
  if (!validation.ok) throw new Error(validation.errors.join(" "));

  const startedAt = performanceNow();
  const instance = await loadWasm();
  const input = serializeInput(puzzle, options);
  const inputPtr = instance.exports.skimmiq_alloc(input.length);

  try {
    new Uint8Array(instance.exports.memory.buffer, inputPtr, input.length).set(input);
    instance.exports.skimmiq_solve(inputPtr, input.length);

    const resultPtr = instance.exports.skimmiq_result_ptr();
    const resultLen = instance.exports.skimmiq_result_len();
    const output = new Uint8Array(instance.exports.memory.buffer, resultPtr, resultLen).slice();
    return parseOutput(output, puzzle, startedAt);
  } finally {
    instance.exports.skimmiq_dealloc(inputPtr, input.length);
  }
}

async function loadWasm() {
  if (!wasmPromise) {
    wasmPromise = fetch(wasmUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load SkimmIQ WASM: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => WebAssembly.instantiate(bytes, {}))
      .then((result) => result.instance);
  }
  return wasmPromise;
}

function serializeInput(puzzle, options) {
  const writer = new BinaryWriter();
  writer.u32(INPUT_MAGIC);
  writer.u32(puzzle.colors.length);
  writer.u32(puzzle.moves.length);

  for (const move of puzzle.moves) {
    writer.u32(move.direction > 0 ? 1 : 0);
    writer.u32(axisCode(move.axis));
    writer.u32(findMoveIndex(puzzle, invertSkimmiqMove(move)));
    writer.u32(move.cycle.length);
    for (const index of move.cycle) writer.u32(index);
  }

  writer.u32(SKIMMIQ_FACES.length);
  for (const face of SKIMMIQ_FACES) {
    const indexes = puzzle.faceStickerIndexes[face];
    writer.u32(indexes.length);
    for (const index of indexes) writer.u32(index);
  }

  writer.u32(puzzle.colors.length);
  writer.bytes(puzzle.colors);
  writer.u32(puzzle.solvedColors.length);
  writer.bytes(puzzle.solvedColors);
  writer.u32(options.tableDepth ?? TABLE_DEPTH_BY_LAYOUT[puzzle.layout.id] ?? 5);
  writer.u32(options.forwardDepth ?? FORWARD_DEPTH_BY_LAYOUT[puzzle.layout.id] ?? 5);

  const tiers = getMacroTiers(options);
  writer.u32(tiers.length);
  for (const tier of tiers) {
    writer.u32(tier.maxDepth);
    writer.u32(tier.width);
    writer.u32(tier.restarts);
  }

  return writer.finish();
}

function parseOutput(bytes, puzzle, startedAt) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const readU32 = () => {
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };

  const magic = readU32();
  if (magic !== OUTPUT_MAGIC) throw new Error("SkimmIQ WASM returned an invalid result.");
  const statusCode = readU32();
  const methodCode = readU32();
  const nodesLow = readU32();
  const nodesHigh = readU32();
  const moveCount = readU32();
  const moveIndexes = [];
  for (let index = 0; index < moveCount; index += 1) moveIndexes.push(readU32());

  const moves = moveIndexes.map((moveIndex) => {
    const move = puzzle.moves[moveIndex];
    if (!move) throw new Error(`SkimmIQ WASM returned an invalid move index: ${moveIndex}`);
    return { tapeId: move.tapeId, direction: move.direction };
  });

  const status = statusCode === STATUS_SOLVED ? "solved" : "search_exhausted";
  return {
    status,
    moves,
    text: skimmiqMovesToString(moves),
    method: METHOD_NAMES[methodCode] || "rust-wasm",
    nodes: nodesLow + nodesHigh * 2 ** 32,
    elapsedMs: Math.round(performanceNow() - startedAt)
  };
}

function getMacroTiers(options) {
  if (
    options.macroWidth !== undefined ||
    options.macroDepth !== undefined ||
    options.macroRestarts !== undefined ||
    options.macroTiers !== undefined
  ) {
    return options.macroTiers ?? [{
      maxDepth: options.macroDepth ?? 80,
      width: options.macroWidth ?? 700,
      restarts: options.macroRestarts ?? 4
    }];
  }

  return [
    { maxDepth: 80, width: 700, restarts: 4 },
    { maxDepth: 105, width: 900, restarts: 3 },
    { maxDepth: 130, width: 1150, restarts: 2 }
  ];
}

function axisCode(axis) {
  if (axis === "x") return 0;
  if (axis === "y") return 1;
  return 2;
}

function findMoveIndex(puzzle, move) {
  const index = puzzle.moves.findIndex(
    (candidate) => candidate.tapeId === move.tapeId && candidate.direction === move.direction
  );
  if (index < 0) throw new Error(`Cannot encode move ${move.tapeId}${move.direction}`);
  return index;
}

function performanceNow() {
  if (typeof performance !== "undefined" && performance.now) return performance.now();
  return Date.now();
}

class BinaryWriter {
  constructor() {
    this.buffer = new ArrayBuffer(4096);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }

  u32(value) {
    this.ensure(4);
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
  }

  bytes(values) {
    this.ensure(values.length);
    new Uint8Array(this.buffer, this.offset, values.length).set(values);
    this.offset += values.length;
  }

  finish() {
    return new Uint8Array(this.buffer, 0, this.offset);
  }

  ensure(bytes) {
    if (this.offset + bytes <= this.buffer.byteLength) return;
    let nextLength = this.buffer.byteLength * 2;
    while (this.offset + bytes > nextLength) nextLength *= 2;
    const next = new ArrayBuffer(nextLength);
    new Uint8Array(next).set(new Uint8Array(this.buffer, 0, this.offset));
    this.buffer = next;
    this.view = new DataView(this.buffer);
  }
}

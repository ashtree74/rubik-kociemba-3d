import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SKIMMIQ_FACES,
  SkimmiqPuzzle,
  deterministicSkimmiqScramble,
  invertSkimmiqMove
} from "../src/skimmiq-model.js";

const wasmBytes = readFileSync(new URL("../src/wasm/skimmiq_solver.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, {});

function solveWithWasm(puzzle) {
  const input = serialize(puzzle);
  const pointer = instance.exports.skimmiq_alloc(input.length);
  new Uint8Array(instance.exports.memory.buffer, pointer, input.length).set(input);
  instance.exports.skimmiq_solve(pointer, input.length);
  instance.exports.skimmiq_dealloc(pointer, input.length);

  const resultPointer = instance.exports.skimmiq_result_ptr();
  const resultLength = instance.exports.skimmiq_result_len();
  const output = new DataView(instance.exports.memory.buffer, resultPointer, resultLength);
  let offset = 0;
  const readU32 = () => {
    const value = output.getUint32(offset, true);
    offset += 4;
    return value;
  };

  assert.equal(readU32(), 0x524f4d53, "bad WASM output magic");
  const status = readU32();
  const method = readU32();
  const nodesLow = readU32();
  const nodesHigh = readU32();
  const moveCount = readU32();
  const moves = [];
  for (let index = 0; index < moveCount; index += 1) {
    const move = puzzle.moves[readU32()];
    moves.push({ tapeId: move.tapeId, direction: move.direction });
  }

  return {
    status,
    method,
    nodes: nodesLow + nodesHigh * 2 ** 32,
    moves
  };
}

function serialize(puzzle) {
  const writer = new Writer();
  writer.u32(0x51494d53);
  writer.u32(puzzle.colors.length);
  writer.u32(puzzle.moves.length);

  for (const move of puzzle.moves) {
    writer.u32(move.direction > 0 ? 1 : 0);
    writer.u32(move.axis === "x" ? 0 : move.axis === "y" ? 1 : 2);
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
  writer.u32(5);
  writer.u32(5);
  writer.u32(3);
  for (const [maxDepth, width, restarts] of [[80, 700, 4], [105, 900, 3], [130, 1150, 2]]) {
    writer.u32(maxDepth);
    writer.u32(width);
    writer.u32(restarts);
  }
  return writer.finish();
}

function findMoveIndex(puzzle, move) {
  return puzzle.moves.findIndex(
    (candidate) => candidate.tapeId === move.tapeId && candidate.direction === move.direction
  );
}

class Writer {
  constructor() {
    this.values = [];
  }

  u32(value) {
    this.values.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
  }

  bytes(bytes) {
    for (const byte of bytes) this.values.push(byte);
  }

  finish() {
    return Uint8Array.from(this.values);
  }
}

for (const [length, seed] of [[8, 101], [20, 303]]) {
  const puzzle = new SkimmiqPuzzle("E", "classic");
  puzzle.applyMoves(deterministicSkimmiqScramble(puzzle, length, seed));
  const result = solveWithWasm(puzzle);
  assert.equal(result.status, 1, `WASM solver should solve ${length}/${seed}`);
  assert.ok(result.nodes > 0, "WASM solver should report visited nodes");
  assert.ok(result.method > 0, "WASM solver should report a method");
  puzzle.applyMoves(result.moves);
  assert.equal(puzzle.isSolved(), true, `WASM solution should solve ${length}/${seed}`);
}

console.log("skimmiq wasm ok");

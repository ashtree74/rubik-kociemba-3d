import assert from "node:assert/strict";
import { CubieCube, parseAlgorithm, parseMoveName, movesToString } from "../src/cube.js";
import {
  KociembaSolver,
  getCornerPerm,
  getFlip,
  getSlice,
  getSlicePerm,
  getTwist,
  getUDEdgePerm,
  solverInternals
} from "../src/solver.js";

const solver = new KociembaSolver();

function apply(text) {
  return CubieCube.identity().applyMoves(parseAlgorithm(text));
}

function assertSolvedAfter(scramble, solution) {
  const cube = CubieCube.identity().applyMoves(scramble).applyMoves(solution);
  assert.equal(cube.isSolved(), true, `Not solved: ${movesToString(scramble)} -> ${movesToString(solution)}`);
}

function randomScramble(length) {
  const moves = [];
  let lastFace = -1;
  let lastAxis = -1;
  while (moves.length < length) {
    const face = Math.floor(Math.random() * 6);
    const axis = face % 3;
    if (face === lastFace || axis === lastAxis) continue;
    moves.push(face * 3 + Math.floor(Math.random() * 3));
    lastFace = face;
    lastAxis = axis;
  }
  return moves;
}

for (const move of ["U", "R", "F", "D", "L", "B"]) {
  const cube = apply(`${move} ${move}'`);
  assert.equal(cube.isSolved(), true, `${move} followed by inverse should solve`);
}

for (let value = 0; value < 50; value += 1) {
  assert.equal(getTwist(solverInternals.setTwist(value)), value);
  assert.equal(getFlip(solverInternals.setFlip(value)), value);
  assert.equal(getSlice(solverInternals.setSlice(value)), value);
  assert.equal(getCornerPerm(solverInternals.setCornerPerm(value)), value);
  assert.equal(getUDEdgePerm(solverInternals.setUDEdgePerm(value)), value);
  assert.equal(getSlicePerm(solverInternals.setSlicePerm(value % 24)), value % 24);
}

const cases = [
  parseAlgorithm("R U R' U'"),
  parseAlgorithm("F R U R' U' F'"),
  parseAlgorithm("R2 F2 U B2 L D' R U2"),
  randomScramble(14),
  randomScramble(20)
];

await solver.initialize((progress) => {
  if (progress.label === "Gotowe") console.log("solver tables ready");
});

for (const scramble of cases) {
  const scrambled = CubieCube.identity().applyMoves(scramble);
  const result = await solver.solve(scrambled, { maxDepth: 30, timeoutMs: 60000 });
  assert.ok(result, `No solution for ${movesToString(scramble)}`);
  assertSolvedAfter(scramble, result.moves);
  console.log(`${movesToString(scramble)} => ${result.text} (${result.moves.length})`);
}

const singleMove = await solver.solve(CubieCube.identity().applyMove(parseMoveName("R")), {
  maxDepth: 30,
  timeoutMs: 60000
});
assertSolvedAfter([parseMoveName("R")], singleMove.moves);
assert.ok(singleMove.moves.length <= 12, "A single move should have a short solution");

console.log("ok");

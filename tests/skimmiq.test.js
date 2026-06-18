import assert from "node:assert/strict";
import {
  SKIMMIQ_LAYOUTS,
  SkimmiqPuzzle,
  buildSolvedStates,
  deterministicSkimmiqScramble,
  invertSkimmiqMove,
  skimmiqMovesToString
} from "../src/skimmiq-model.js";
import { solveSkimmiq } from "../src/skimmiq-solver.js";

const expectedStickerCounts = {
  A: 10,
  B: 14,
  C: 16,
  D: 24,
  E: 54,
  F: 30
};

for (const layout of Object.values(SKIMMIQ_LAYOUTS)) {
  const puzzle = new SkimmiqPuzzle(layout.id, "classic");
  assert.equal(puzzle.stickers.length, expectedStickerCounts[layout.id], `bad sticker count for ${layout.id}`);
  assert.equal(puzzle.tapes.length, layout.rows + layout.cols + layout.layers, `bad tape count for ${layout.id}`);
  assert.equal(puzzle.moves.length, puzzle.tapes.length * 2, `bad move count for ${layout.id}`);
  assert.equal(puzzle.isSolved(), true, `${layout.id} should start solved`);

  for (const move of puzzle.moves) {
    const before = puzzle.key();
    puzzle.applyMove(move);
    puzzle.applyMove(invertSkimmiqMove(move));
    assert.equal(puzzle.key(), before, `${layout.id} ${move.tapeId} inverse should restore state`);
  }
}

const validationPuzzle = new SkimmiqPuzzle("E", "classic");
validationPuzzle.colors[0] = validationPuzzle.colors[1];
assert.equal(validationPuzzle.validate().ok, false, "validation should reject changed color counts");

const goalPuzzle = new SkimmiqPuzzle("D", "classic");
const goals = buildSolvedStates(goalPuzzle);
assert.ok(goals.length > 0, "should generate solved goal states");
assert.ok(goals.some((goal) => goalPuzzle.key(goal) === goalPuzzle.key()), "generated goals should include reset state");

function assertSolution(layoutId, scrambleLength, seed, maxDepth = 28) {
  const puzzle = new SkimmiqPuzzle(layoutId, "classic");
  const scramble = deterministicSkimmiqScramble(puzzle, scrambleLength, seed);
  puzzle.applyMoves(scramble);
  const scrambledKey = puzzle.key();
  const result = solveSkimmiq(puzzle.toJSON(), { timeoutMs: 12000, maxDepth, beamWidth: 900 });
  assert.equal(
    result.status,
    "solved",
    `solver failed ${layoutId}: ${skimmiqMovesToString(scramble)} -> ${JSON.stringify(result)}`
  );
  assert.equal(puzzle.key(), scrambledKey, "solver must not mutate caller state");
  puzzle.applyMoves(result.moves);
  assert.equal(puzzle.isSolved(), true, `solution does not solve ${layoutId}: ${result.text}`);
  return result;
}

function assertShuffledSolution(seed) {
  const solved = new SkimmiqPuzzle("E", "classic");
  const colors = Array.from(solved.colors);
  let state = seed >>> 0;
  for (let index = colors.length - 1; index > 0; index -= 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [colors[index], colors[swapIndex]] = [colors[swapIndex], colors[index]];
  }

  const puzzle = new SkimmiqPuzzle("E", "classic", colors);
  assert.equal(puzzle.validate().ok, true, "shuffled color state should be valid");
  const result = solveSkimmiq(puzzle.toJSON(), { macroWidth: 700, macroDepth: 80 });
  assert.equal(result.status, "solved", `solver failed shuffled E state ${seed}: ${JSON.stringify(result)}`);
  puzzle.applyMoves(result.moves);
  assert.equal(puzzle.isSolved(), true, `shuffled E solution does not solve: ${result.text}`);
}

const oneMovePuzzle = new SkimmiqPuzzle("A", "classic");
oneMovePuzzle.applyMove({ tapeId: "x0", direction: 1 });
const oneMove = solveSkimmiq(oneMovePuzzle.toJSON(), { timeoutMs: 5000, maxDepth: 8 });
assert.equal(oneMove.status, "solved");
assert.equal(oneMove.moves.length, 1, "single move should be solved optimally on small layouts");

assertSolution("A", 5, 11, 12);
assertSolution("B", 6, 17, 14);
assertSolution("C", 6, 23, 14);
assertSolution("D", 5, 31, 16);
assertSolution("E", 4, 41, 14);
assertSolution("E", 20, 303, 80);
assertShuffledSolution(424242);

console.log("skimmiq ok");

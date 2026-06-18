import assert from "node:assert/strict";
import {
  SKIMMIQ_LAYOUTS,
  SkimmiqPuzzle,
  buildSolvedStates,
  invertSkimmiqMove
} from "../src/skimmiq-model.js";

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

console.log("skimmiq ok");

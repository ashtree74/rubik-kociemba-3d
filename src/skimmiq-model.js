export const SKIMMIQ_FACES = Object.freeze(["front", "back", "left", "right", "top", "bottom"]);

export const SKIMMIQ_LAYOUTS = Object.freeze({
  A: Object.freeze({ id: "A", label: "A", title: "1x1x2", rows: 1, cols: 1, layers: 2 }),
  B: Object.freeze({ id: "B", label: "B", title: "1x1x3", rows: 1, cols: 1, layers: 3 }),
  C: Object.freeze({ id: "C", label: "C", title: "2x2x1", rows: 2, cols: 2, layers: 1 }),
  D: Object.freeze({ id: "D", label: "D", title: "2x2x2", rows: 2, cols: 2, layers: 2 }),
  E: Object.freeze({ id: "E", label: "E", title: "3x3x3", rows: 3, cols: 3, layers: 3 }),
  F: Object.freeze({ id: "F", label: "F", title: "3x3x1", rows: 3, cols: 3, layers: 1 })
});

export const SKIMMIQ_DIFFICULTIES = Object.freeze({
  easy: Object.freeze({
    id: "easy",
    label: "Easy",
    colors: Object.freeze({
      top: "red",
      right: "white",
      front: "white",
      left: "white",
      back: "white",
      bottom: "red"
    })
  }),
  moderate: Object.freeze({
    id: "moderate",
    label: "Moderate",
    colors: Object.freeze({
      top: "white",
      right: "red",
      front: "green",
      left: "red",
      back: "green",
      bottom: "white"
    })
  }),
  classic: Object.freeze({
    id: "classic",
    label: "Classic",
    colors: Object.freeze({
      top: "white",
      right: "red",
      front: "blue",
      left: "magenta",
      back: "green",
      bottom: "yellow"
    })
  })
});

export const SKIMMIQ_COLOR_ORDER = Object.freeze(["white", "red", "blue", "magenta", "green", "yellow"]);

const COLOR_TO_CODE = Object.freeze(
  Object.fromEntries(SKIMMIQ_COLOR_ORDER.map((color, index) => [color, index]))
);

const CODE_TO_COLOR = Object.freeze(
  Object.fromEntries(SKIMMIQ_COLOR_ORDER.map((color, index) => [index, color]))
);

export class SkimmiqPuzzle {
  constructor(layoutId = "E", difficultyId = "classic", colors = null) {
    this.layout = resolveLayout(layoutId);
    this.difficulty = resolveDifficulty(difficultyId);
    this.stickers = buildStickers(this.layout);
    this.stickerIndexById = new Map(this.stickers.map((sticker, index) => [sticker.id, index]));
    this.faceStickerIndexes = buildFaceStickerIndexes(this.stickers);
    this.tapes = buildTapes(this.layout, this.stickerIndexById);
    this.moves = buildMoves(this.tapes);
    this.solvedColors = buildSolvedColors(this.stickers, this.difficulty);
    this.targetColorCounts = countColors(this.solvedColors);
    this.colors = colors ? Uint8Array.from(colors) : Uint8Array.from(this.solvedColors);
  }

  static fromJSON(value) {
    return new SkimmiqPuzzle(value.layoutId, value.difficultyId, value.colors);
  }

  clone() {
    return new SkimmiqPuzzle(this.layout.id, this.difficulty.id, this.colors);
  }

  reset() {
    this.colors = Uint8Array.from(this.solvedColors);
    return this;
  }

  toJSON() {
    return {
      layoutId: this.layout.id,
      difficultyId: this.difficulty.id,
      colors: Array.from(this.colors)
    };
  }

  key(colors = this.colors) {
    let value = "";
    for (let i = 0; i < colors.length; i += 1) {
      value += String.fromCharCode(48 + colors[i]);
    }
    return value;
  }

  applyMove(move) {
    applySkimmiqMove(this.colors, this.getMove(move));
    return this;
  }

  applyMoves(moves) {
    for (const move of moves) this.applyMove(move);
    return this;
  }

  previewMove(move) {
    const resolved = this.getMove(move);
    const colors = Uint8Array.from(this.colors);
    applySkimmiqMove(colors, resolved);
    return colors;
  }

  getMove(move) {
    if (typeof move === "string") return parseSkimmiqMove(move, this.moves);
    if (typeof move === "number") return this.moves[move];
    if (move && typeof move === "object") {
      const tapeId = String(move.tapeId);
      const direction = Number(move.direction) >= 0 ? 1 : -1;
      const found = this.moves.find((candidate) => candidate.tapeId === tapeId && candidate.direction === direction);
      if (found) return found;
    }
    throw new Error(`Unknown SkimmIQ move: ${JSON.stringify(move)}`);
  }

  isSolved(colors = this.colors) {
    return isSkimmiqSolved(colors, this.faceStickerIndexes);
  }

  validate(colors = this.colors) {
    const errors = [];
    if (!colors || colors.length !== this.stickers.length) {
      errors.push("State has an invalid sticker count.");
      return { ok: false, errors };
    }
    const counts = countColors(colors);
    for (const color of Object.keys(this.targetColorCounts)) {
      if ((counts[color] || 0) !== this.targetColorCounts[color]) {
        errors.push("State color counts do not match the selected difficulty.");
        break;
      }
    }
    for (let i = 0; i < colors.length; i += 1) {
      if (!Number.isInteger(colors[i]) || !CODE_TO_COLOR[colors[i]]) {
        errors.push("State contains an unknown color code.");
        break;
      }
    }
    return { ok: errors.length === 0, errors };
  }
}

export function resolveLayout(layoutId) {
  const id = String(layoutId || "E").toUpperCase();
  const layout = SKIMMIQ_LAYOUTS[id];
  if (!layout) throw new Error(`Unknown SkimmIQ layout: ${layoutId}`);
  return layout;
}

export function resolveDifficulty(difficultyId) {
  const id = String(difficultyId || "classic").toLowerCase();
  const difficulty = SKIMMIQ_DIFFICULTIES[id];
  if (!difficulty) throw new Error(`Unknown SkimmIQ difficulty: ${difficultyId}`);
  return difficulty;
}

export function colorNameToCode(color) {
  const code = COLOR_TO_CODE[color];
  if (!Number.isInteger(code)) throw new Error(`Unknown SkimmIQ color: ${color}`);
  return code;
}

export function colorCodeToName(code) {
  return CODE_TO_COLOR[code] || "white";
}

export function skimmiqMoveToString(move) {
  const resolved = typeof move === "string" ? parseMoveText(move) : move;
  return `${resolved.tapeId}${resolved.direction > 0 ? "+" : "-"}`;
}

export function skimmiqMovesToString(moves) {
  return moves.map(skimmiqMoveToString).join(" ");
}

export function invertSkimmiqMove(move) {
  const resolved = typeof move === "string" ? parseMoveText(move) : move;
  return { tapeId: resolved.tapeId, direction: -resolved.direction };
}

export function invertSkimmiqMoves(moves) {
  return Array.from(moves).reverse().map(invertSkimmiqMove);
}

export function applySkimmiqMove(colors, move) {
  const cycle = move.cycle;
  if (move.direction > 0) {
    const saved = colors[cycle[cycle.length - 1]];
    for (let i = cycle.length - 1; i > 0; i -= 1) {
      colors[cycle[i]] = colors[cycle[i - 1]];
    }
    colors[cycle[0]] = saved;
  } else {
    const saved = colors[cycle[0]];
    for (let i = 0; i < cycle.length - 1; i += 1) {
      colors[cycle[i]] = colors[cycle[i + 1]];
    }
    colors[cycle[cycle.length - 1]] = saved;
  }
  return colors;
}

export function parseSkimmiqMove(text, moves = null) {
  const parsed = parseMoveText(text);
  if (!moves) return parsed;
  const found = moves.find((move) => move.tapeId === parsed.tapeId && move.direction === parsed.direction);
  if (!found) throw new Error(`Move ${text} is not available for this layout.`);
  return found;
}

export function buildSolvedStates(puzzle, limit = 1000) {
  const faceSizes = Object.fromEntries(
    SKIMMIQ_FACES.map((face) => [face, puzzle.faceStickerIndexes[face].length])
  );
  const remaining = { ...puzzle.targetColorCounts };
  const assignments = [];

  function visit(faceIndex, assignment) {
    if (assignments.length >= limit) return;
    if (faceIndex === SKIMMIQ_FACES.length) {
      if (Object.values(remaining).every((count) => count === 0)) {
        assignments.push({ ...assignment });
      }
      return;
    }

    const face = SKIMMIQ_FACES[faceIndex];
    const size = faceSizes[face];
    for (const colorCodeText of Object.keys(remaining)) {
      const colorCode = Number(colorCodeText);
      if (remaining[colorCode] < size) continue;
      remaining[colorCode] -= size;
      assignment[face] = colorCode;
      visit(faceIndex + 1, assignment);
      delete assignment[face];
      remaining[colorCode] += size;
    }
  }

  visit(0, {});

  return assignments.map((assignment) => {
    const colors = new Uint8Array(puzzle.stickers.length);
    for (const face of SKIMMIQ_FACES) {
      for (const index of puzzle.faceStickerIndexes[face]) {
        colors[index] = assignment[face];
      }
    }
    return colors;
  });
}

export function isSkimmiqSolved(colors, faceStickerIndexes) {
  for (const face of SKIMMIQ_FACES) {
    const indexes = faceStickerIndexes[face];
    if (!indexes.length) continue;
    const first = colors[indexes[0]];
    for (let i = 1; i < indexes.length; i += 1) {
      if (colors[indexes[i]] !== first) return false;
    }
  }
  return true;
}

export function deterministicSkimmiqScramble(puzzle, length, seed = 1) {
  const moves = [];
  let state = seed >>> 0;
  let lastTape = "";
  for (let i = 0; i < length; i += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    let move = puzzle.moves[state % puzzle.moves.length];
    if (move.tapeId === lastTape && puzzle.moves.length > 2) {
      move = puzzle.moves[(state + 3) % puzzle.moves.length];
    }
    moves.push({ tapeId: move.tapeId, direction: move.direction });
    lastTape = move.tapeId;
  }
  return moves;
}

function buildStickers(layout) {
  const stickers = [];
  for (let x = 0; x < layout.rows; x += 1) {
    for (let y = 0; y < layout.cols; y += 1) {
      for (let z = 0; z < layout.layers; z += 1) {
        for (const face of SKIMMIQ_FACES) {
          if (!isVisible(layout, face, x, y, z)) continue;
          stickers.push({ id: `${face}_${x}_${y}_${z}`, face, x, y, z, homeFace: face });
        }
      }
    }
  }
  return stickers;
}

function isVisible(layout, face, x, y, z) {
  const maxX = layout.rows - 1;
  const maxY = layout.cols - 1;
  const maxZ = layout.layers - 1;
  return (
    (face === "front" && z === maxZ) ||
    (face === "back" && z === 0) ||
    (face === "left" && x === 0) ||
    (face === "right" && x === maxX) ||
    (face === "top" && y === maxY) ||
    (face === "bottom" && y === 0)
  );
}

function buildFaceStickerIndexes(stickers) {
  const indexes = Object.fromEntries(SKIMMIQ_FACES.map((face) => [face, []]));
  stickers.forEach((sticker, index) => indexes[sticker.face].push(index));
  return indexes;
}

function buildTapes(layout, stickerIndexById) {
  const maxX = layout.rows - 1;
  const maxY = layout.cols - 1;
  const maxZ = layout.layers - 1;
  const tapes = [];

  for (let y = 0; y <= maxY; y += 1) {
    const ids = [];
    for (let x = 0; x <= maxX; x += 1) ids.push(`front_${x}_${y}_${maxZ}`);
    for (let z = maxZ; z >= 0; z -= 1) ids.push(`right_${maxX}_${y}_${z}`);
    for (let x = maxX; x >= 0; x -= 1) ids.push(`back_${x}_${y}_0`);
    for (let z = 0; z <= maxZ; z += 1) ids.push(`left_0_${y}_${z}`);
    tapes.push(buildTape(`y${y}`, "y", y, ids, stickerIndexById));
  }

  for (let x = 0; x <= maxX; x += 1) {
    const ids = [];
    for (let y = maxY; y >= 0; y -= 1) ids.push(`front_${x}_${y}_${maxZ}`);
    for (let z = maxZ; z >= 0; z -= 1) ids.push(`bottom_${x}_0_${z}`);
    for (let y = 0; y <= maxY; y += 1) ids.push(`back_${x}_${y}_0`);
    for (let z = 0; z <= maxZ; z += 1) ids.push(`top_${x}_${maxY}_${z}`);
    tapes.push(buildTape(`x${x}`, "x", x, ids, stickerIndexById));
  }

  for (let z = 0; z <= maxZ; z += 1) {
    const ids = [];
    for (let x = 0; x <= maxX; x += 1) ids.push(`top_${x}_${maxY}_${z}`);
    for (let y = maxY; y >= 0; y -= 1) ids.push(`right_${maxX}_${y}_${z}`);
    for (let x = maxX; x >= 0; x -= 1) ids.push(`bottom_${x}_0_${z}`);
    for (let y = 0; y <= maxY; y += 1) ids.push(`left_0_${y}_${z}`);
    tapes.push(buildTape(`z${z}`, "z", z, ids, stickerIndexById));
  }

  return tapes;
}

function buildTape(id, axis, index, stickerIds, stickerIndexById) {
  return {
    id,
    axis,
    index,
    stickerIds,
    cycle: stickerIds.map((stickerId) => {
      const stickerIndex = stickerIndexById.get(stickerId);
      if (!Number.isInteger(stickerIndex)) throw new Error(`Tape ${id} references missing sticker ${stickerId}`);
      return stickerIndex;
    })
  };
}

function buildMoves(tapes) {
  return tapes.flatMap((tape) => [
    { tapeId: tape.id, direction: 1, cycle: tape.cycle, axis: tape.axis, index: tape.index },
    { tapeId: tape.id, direction: -1, cycle: tape.cycle, axis: tape.axis, index: tape.index }
  ]);
}

function buildSolvedColors(stickers, difficulty) {
  return Uint8Array.from(stickers.map((sticker) => colorNameToCode(difficulty.colors[sticker.homeFace])));
}

function countColors(colors) {
  const counts = {};
  for (const color of colors) {
    counts[color] = (counts[color] || 0) + 1;
  }
  return counts;
}

function parseMoveText(text) {
  const match = String(text).trim().match(/^([xyz]\d+)\s*([+-])$/i);
  if (!match) throw new Error(`Invalid SkimmIQ move: ${text}`);
  return {
    tapeId: match[1].toLowerCase(),
    direction: match[2] === "+" ? 1 : -1
  };
}

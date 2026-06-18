import {
  SkimmiqPuzzle,
  applySkimmiqMove,
  invertSkimmiqMove,
  skimmiqMovesToString
} from "./skimmiq-model.js";

const DEFAULT_MAX_DEPTH = 40;
const TABLE_CACHE = new Map();
const OPERATION_CACHE = new Map();

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

export function solveSkimmiq(state, options = {}) {
  const puzzle = SkimmiqPuzzle.fromJSON(state);
  const validation = puzzle.validate();
  if (!validation.ok) {
    throw new Error(validation.errors.join(" "));
  }

  const startedAt = performanceNow();
  const context = {
    nodes: 0,
    onProgress: options.onProgress || (() => {}),
    startedAt
  };

  if (puzzle.isSolved()) {
    return buildResult("solved", [], "none", context.nodes, startedAt);
  }

  const tableDepth = options.tableDepth ?? TABLE_DEPTH_BY_LAYOUT[puzzle.layout.id] ?? 5;
  const forwardDepth = options.forwardDepth ?? FORWARD_DEPTH_BY_LAYOUT[puzzle.layout.id] ?? 5;
  const table = getReverseTable(puzzle, tableDepth, context);
  const exact = meetInMiddleSolve(puzzle, table, forwardDepth, context);
  if (exact.status === "solved") {
    return buildResult("solved", exact.moves, "meet-in-the-middle", context.nodes, startedAt);
  }

  for (const [tierIndex, tier] of getMacroTiers(options).entries()) {
    const macro = macroBeamSolve(puzzle, {
      table,
      maxDepth: tier.maxDepth,
      width: tier.width,
      restarts: tier.restarts,
      tier: tierIndex,
      context
    });
    if (macro.status === "solved") {
      return buildResult("solved", macro.moves, "macro-commutator", context.nodes, startedAt);
    }
  }

  if (options.classicBeam === true) {
    const beam = beamSolve(puzzle, {
      table,
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
      width: options.beamWidth ?? 2200,
      restarts: options.restarts ?? 6,
      context
    });
    if (beam.status === "solved") {
      return buildResult("solved", beam.moves, "guided-beam", context.nodes, startedAt);
    }
  }

  return buildResult("search_exhausted", [], "macro-commutator", context.nodes, startedAt);
}

function meetInMiddleSolve(puzzle, table, forwardDepth, context) {
  const startKey = stateKey(puzzle.colors);
  const direct = table.states.get(startKey);
  if (direct) return { status: "solved", moves: decodePath(direct.path, puzzle) };

  let frontier = [{
    colors: Uint8Array.from(puzzle.colors),
    path: [],
    lastMove: null
  }];
  const seen = new Set([startKey]);

  for (let depth = 0; depth < forwardDepth; depth += 1) {
    context.onProgress({
      phase: "exact-forward",
      depth,
      nodes: context.nodes,
      frontier: frontier.length,
      tableSize: table.states.size,
      elapsedMs: elapsed(context)
    });

    const next = [];
    for (const entry of frontier) {
      for (const move of puzzle.moves) {
        if (isImmediateInverse(entry.lastMove, move)) continue;
        const colors = Uint8Array.from(entry.colors);
        applySkimmiqMove(colors, move);
        context.nodes += 1;
        const key = stateKey(colors);
        if (seen.has(key)) continue;

        const path = entry.path.concat(simplifyMove(move));
        const suffix = table.states.get(key);
        if (suffix) {
          return {
            status: "solved",
            moves: path.concat(decodePath(suffix.path, puzzle))
          };
        }

        seen.add(key);
        next.push({ colors, path, lastMove: move });
      }
    }
    frontier = next;
  }

  return { status: "not_found" };
}

function getReverseTable(puzzle, depth, context) {
  const cacheKey = `${puzzle.layout.id}:${puzzle.difficulty.id}:${depth}`;
  const cached = TABLE_CACHE.get(cacheKey);
  if (cached) return cached;

  const table = {
    states: new Map([[stateKey(puzzle.solvedColors), { path: "" }]])
  };
  let frontier = [{
    colors: Uint8Array.from(puzzle.solvedColors),
    path: "",
    lastMove: null
  }];

  for (let level = 0; level < depth; level += 1) {
    context.onProgress({
      phase: "table-build",
      depth: level,
      nodes: context.nodes,
      frontier: frontier.length,
      tableSize: table.states.size,
      elapsedMs: elapsed(context)
    });

    const next = [];
    for (const entry of frontier) {
      for (let moveIndex = 0; moveIndex < puzzle.moves.length; moveIndex += 1) {
        const move = puzzle.moves[moveIndex];
        if (isImmediateInverse(entry.lastMove, move)) continue;
        const colors = Uint8Array.from(entry.colors);
        applySkimmiqMove(colors, move);
        context.nodes += 1;
        const key = stateKey(colors);
        if (table.states.has(key)) continue;

        const inverseIndex = findMoveIndex(puzzle, invertSkimmiqMove(move));
        const path = encodePath([inverseIndex]) + entry.path;
        const record = { path };
        table.states.set(key, record);
        next.push({ colors, path, lastMove: move });
      }
    }
    frontier = next;
  }

  context.onProgress({
    phase: "table-ready",
    depth,
    nodes: context.nodes,
    frontier: frontier.length,
    tableSize: table.states.size,
    elapsedMs: elapsed(context)
  });
  TABLE_CACHE.set(cacheKey, table);
  return table;
}

function beamSolve(puzzle, { table, maxDepth, width, restarts, context }) {
  let best = null;
  for (let restart = 0; restart < restarts; restart += 1) {
    const jitter = restart === 0 ? 0 : 80 + restart * 35;
    const seed = 0x9e3779b9 + restart * 1013904223 + puzzle.colors.length;
    const result = runBeamAttempt(puzzle, {
      maxDepth,
      width,
      jitter,
      seed,
      restart,
      table,
      context
    });
    if (result.status === "solved") return result;
    if (!best || result.bestScore < best.bestScore) best = result;
  }
  return { status: "not_found", bestScore: best?.bestScore ?? Infinity };
}

function runBeamAttempt(puzzle, { maxDepth, width, jitter, seed, restart, table, context }) {
  const random = mulberry32(seed);
  let beam = [{
    colors: Uint8Array.from(puzzle.colors),
    path: [],
    lastMove: null,
    score: scoreState(puzzle.colors, puzzle)
  }];
  const seen = new Map([[stateKey(puzzle.colors), 0]]);
  let bestScore = beam[0].score;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    context.onProgress({
      phase: "guided-beam",
      restart,
      depth,
      nodes: context.nodes,
      frontier: beam.length,
      bestScore,
      elapsedMs: elapsed(context)
    });

    const candidates = [];
    for (const entry of beam) {
      for (const move of puzzle.moves) {
        if (isImmediateInverse(entry.lastMove, move)) continue;
        const colors = Uint8Array.from(entry.colors);
        applySkimmiqMove(colors, move);
        context.nodes += 1;

        const path = entry.path.concat(simplifyMove(move));
        const key = stateKey(colors);
        const suffix = table.states.get(key);
        if (suffix) {
          return {
            status: "solved",
            moves: path.concat(decodePath(suffix.path, puzzle)),
            bestScore: 0
          };
        }

        if (puzzle.isSolved(colors)) return { status: "solved", moves: path, bestScore: 0 };

        const seenDepth = seen.get(key);
        if (seenDepth !== undefined && seenDepth <= depth + 1) continue;
        seen.set(key, depth + 1);

        const score = scoreState(colors, puzzle) + (random() - 0.5) * jitter;
        bestScore = Math.min(bestScore, score);
        candidates.push({ colors, path, lastMove: move, score });
      }
    }

    if (!candidates.length) break;
    candidates.sort((a, b) => a.score - b.score || a.path.length - b.path.length);
    const deterministicKeep = Math.floor(width * 0.82);
    const next = candidates.slice(0, deterministicKeep);
    for (let i = deterministicKeep; i < candidates.length && next.length < width; i += 1) {
      if (random() < 0.07) next.push(candidates[i]);
    }
    for (let i = deterministicKeep; i < candidates.length && next.length < width; i += 1) {
      next.push(candidates[i]);
    }
    beam = next;
  }

  return { status: "not_found", bestScore };
}

function macroBeamSolve(puzzle, { table, maxDepth, width, restarts, tier, context }) {
  const operations = getSearchOperations(puzzle);
  let bestOverall = Infinity;
  const seedBase = hashColors(puzzle.colors);

  for (let restart = 0; restart < restarts; restart += 1) {
    const random = mulberry32(seedBase + restart * 0x9e3779b9);
    const jitter = restart === 0 ? 0 : 120 + restart * 60;
    const initialScore = scoreState(puzzle.colors, puzzle);
    let beam = [{
      colors: Uint8Array.from(puzzle.colors),
      path: "",
      lastMove: null,
      score: initialScore,
      rankScore: initialScore
    }];
    let bestScore = beam[0].score;

    for (let depth = 0; depth < maxDepth; depth += 1) {
      context.onProgress({
        phase: "macro-beam",
        tier,
        restart,
        depth,
        nodes: context.nodes,
        frontier: beam.length,
        bestScore: Math.min(bestOverall, bestScore),
        elapsedMs: elapsed(context)
      });

      const candidates = [];
      const layerSeen = new Set();
      for (const entry of beam) {
        for (const operation of operations) {
          if (operation.isRaw && isImmediateInverse(entry.lastMove, operation.moves[0])) continue;
          const colors = applyOperation(entry.colors, operation);
          context.nodes += 1;

          const key = stateKey(colors);
          if (layerSeen.has(key)) continue;
          layerSeen.add(key);

          const path = entry.path + operation.path;
          const suffix = table.states.get(key);
          if (suffix) {
            return {
              status: "solved",
              moves: decodePath(path + suffix.path, puzzle),
              bestScore: 0
            };
          }

          if (puzzle.isSolved(colors)) {
            return {
              status: "solved",
              moves: decodePath(path, puzzle),
              bestScore: 0
            };
          }

          const score = scoreState(colors, puzzle) + path.length * 1.5;
          const rankScore = score + (random() - 0.5) * jitter;
          bestScore = Math.min(bestScore, score);
          bestOverall = Math.min(bestOverall, score);
          candidates.push({
            colors,
            path,
            lastMove: operation.lastMove,
            score,
            rankScore
          });
        }
      }

      if (!candidates.length) break;
      candidates.sort((a, b) => a.rankScore - b.rankScore || a.path.length - b.path.length);
      beam = candidates.slice(0, width);
    }
  }

  return { status: "not_found", bestScore: bestOverall };
}

function getSearchOperations(puzzle) {
  const cacheKey = puzzle.layout.id;
  const cached = OPERATION_CACHE.get(cacheKey);
  if (cached) return cached;

  const operations = puzzle.moves.map((move, index) => ({
    isRaw: true,
    moves: [move],
    path: encodePath([index]),
    lastMove: move
  }));

  const seenMacros = new Set();
  for (let firstIndex = 0; firstIndex < puzzle.moves.length; firstIndex += 1) {
    const first = puzzle.moves[firstIndex];
    for (let secondIndex = 0; secondIndex < puzzle.moves.length; secondIndex += 1) {
      const second = puzzle.moves[secondIndex];
      if (first.axis === second.axis) continue;

      const firstInverse = invertSkimmiqMove(first);
      const secondInverse = invertSkimmiqMove(second);
      const firstInverseIndex = findMoveIndex(puzzle, firstInverse);
      const secondInverseIndex = findMoveIndex(puzzle, secondInverse);
      const moves = [
        first,
        second,
        puzzle.moves[firstInverseIndex],
        puzzle.moves[secondInverseIndex]
      ];
      const permutationKey = operationPermutationKey(puzzle, moves);
      if (seenMacros.has(permutationKey)) continue;
      seenMacros.add(permutationKey);

      operations.push({
        isRaw: false,
        moves,
        path: encodePath([firstIndex, secondIndex, firstInverseIndex, secondInverseIndex]),
        lastMove: moves[moves.length - 1]
      });
    }
  }

  OPERATION_CACHE.set(cacheKey, operations);
  return operations;
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

function applyOperation(colors, operation) {
  const next = Uint8Array.from(colors);
  for (const move of operation.moves) applySkimmiqMove(next, move);
  return next;
}

function operationPermutationKey(puzzle, moves) {
  const permutation = Array.from({ length: puzzle.stickers.length }, (_, index) => index);
  for (const move of moves) {
    const previous = permutation.slice();
    const shift = move.direction > 0 ? 1 : -1;
    for (let index = 0; index < move.cycle.length; index += 1) {
      const from = move.cycle[index];
      const to = move.cycle[(index + shift + move.cycle.length) % move.cycle.length];
      permutation[to] = previous[from];
    }
  }
  return permutation.join(",");
}

function scoreState(colors, puzzle) {
  let disorder = 0;
  let uniquePenalty = 0;
  let solvedFaces = 0;
  let tailConcentration = 0;
  let worstFace = 0;
  let pairBonus = 0;

  for (const indexes of Object.values(puzzle.faceStickerIndexes)) {
    const counts = new Map();
    for (const index of indexes) {
      counts.set(colors[index], (counts.get(colors[index]) || 0) + 1);
    }
    let best = 0;
    const sortedCounts = Array.from(counts.values()).sort((a, b) => b - a);
    for (const count of sortedCounts) {
      best = Math.max(best, count);
      pairBonus += count * count;
    }
    const miss = indexes.length - best;
    worstFace = Math.max(worstFace, miss);
    disorder += miss;
    uniquePenalty += Math.max(0, counts.size - 1);
    if (miss === 0) solvedFaces += 1;
    tailConcentration += sortedCounts.slice(1).reduce((sum, count) => sum + count * count, 0);
  }

  return (
    disorder * 120
    + worstFace * 25
    + uniquePenalty * 25
    - solvedFaces * 120
    - tailConcentration
    - pairBonus * 0.2
  );
}

function simplifyMove(move) {
  return { tapeId: move.tapeId, direction: move.direction };
}

function findMoveIndex(puzzle, move) {
  const index = puzzle.moves.findIndex(
    (candidate) => candidate.tapeId === move.tapeId && candidate.direction === move.direction
  );
  if (index < 0) throw new Error(`Cannot encode move ${move.tapeId}${move.direction}`);
  return index;
}

function encodePath(indexes) {
  return indexes.map((index) => String.fromCharCode(65 + index)).join("");
}

function stateKey(colors) {
  let key = "";
  for (let index = 0; index < colors.length; index += 6) {
    let value = 0;
    let multiplier = 1;
    for (let offset = 0; offset < 6 && index + offset < colors.length; offset += 1) {
      value += colors[index + offset] * multiplier;
      multiplier *= 6;
    }
    key += String.fromCharCode(value + 1);
  }
  return key;
}

function hashColors(colors) {
  let hash = 2166136261;
  for (const color of colors) {
    hash ^= color + 31;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function decodePath(path, puzzle) {
  return Array.from(path).map((char) => {
    const index = char.charCodeAt(0) - 65;
    return simplifyMove(puzzle.moves[index]);
  });
}

function isImmediateInverse(previous, move) {
  return previous && previous.tapeId === move.tapeId && previous.direction === -move.direction;
}

function buildResult(status, moves, method, nodes, startedAt) {
  return {
    status,
    moves,
    text: skimmiqMovesToString(moves),
    method,
    nodes,
    elapsedMs: Math.round(performanceNow() - startedAt)
  };
}

function elapsed(context) {
  return Math.round(performanceNow() - context.startedAt);
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function performanceNow() {
  if (typeof performance !== "undefined" && performance.now) return performance.now();
  return Date.now();
}

export const skimmiqSolverInternals = {
  scoreState
};

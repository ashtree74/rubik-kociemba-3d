export const CORNERS = Object.freeze({
  URF: 0,
  UFL: 1,
  ULB: 2,
  UBR: 3,
  DFR: 4,
  DLF: 5,
  DBL: 6,
  DRB: 7
});

export const EDGES = Object.freeze({
  UR: 0,
  UF: 1,
  UL: 2,
  UB: 3,
  DR: 4,
  DF: 5,
  DL: 6,
  DB: 7,
  FR: 8,
  FL: 9,
  BL: 10,
  BR: 11
});

export const FACE_ORDER = Object.freeze(["U", "R", "F", "D", "L", "B"]);
export const MOVE_NAMES = Object.freeze(
  FACE_ORDER.flatMap((face) => [face, `${face}2`, `${face}'`])
);
export const FACE_AXIS = Object.freeze([0, 1, 2, 0, 1, 2]);
export const MOVE_FACE = Object.freeze(MOVE_NAMES.map((_, index) => Math.floor(index / 3)));

const SOLVED_CP = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]);
const SOLVED_CO = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0]);
const SOLVED_EP = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const SOLVED_EO = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

const BASE_MOVES = Object.freeze([
  {
    cp: [3, 0, 1, 2, 4, 5, 6, 7],
    co: [0, 0, 0, 0, 0, 0, 0, 0],
    ep: [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  {
    cp: [4, 1, 2, 0, 7, 5, 6, 3],
    co: [2, 0, 0, 1, 1, 0, 0, 2],
    ep: [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  {
    cp: [1, 5, 2, 3, 0, 4, 6, 7],
    co: [1, 2, 0, 0, 2, 1, 0, 0],
    ep: [0, 9, 2, 3, 4, 8, 6, 7, 1, 5, 10, 11],
    eo: [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0]
  },
  {
    cp: [0, 1, 2, 3, 5, 6, 7, 4],
    co: [0, 0, 0, 0, 0, 0, 0, 0],
    ep: [0, 1, 2, 3, 5, 6, 7, 4, 8, 9, 10, 11],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  {
    cp: [0, 2, 6, 3, 4, 1, 5, 7],
    co: [0, 1, 2, 0, 0, 2, 1, 0],
    ep: [0, 1, 10, 3, 4, 5, 9, 7, 8, 2, 6, 11],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  {
    cp: [0, 1, 3, 7, 4, 5, 2, 6],
    co: [0, 0, 1, 2, 0, 0, 2, 1],
    ep: [0, 1, 2, 11, 4, 5, 6, 10, 8, 9, 3, 7],
    eo: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1]
  }
]);

export class CubieCube {
  constructor(cp = SOLVED_CP, co = SOLVED_CO, ep = SOLVED_EP, eo = SOLVED_EO) {
    this.cp = Array.from(cp);
    this.co = Array.from(co);
    this.ep = Array.from(ep);
    this.eo = Array.from(eo);
  }

  static identity() {
    return new CubieCube();
  }

  static fromJSON(value) {
    return new CubieCube(value.cp, value.co, value.ep, value.eo);
  }

  clone() {
    return new CubieCube(this.cp, this.co, this.ep, this.eo);
  }

  toJSON() {
    return {
      cp: Array.from(this.cp),
      co: Array.from(this.co),
      ep: Array.from(this.ep),
      eo: Array.from(this.eo)
    };
  }

  multiply(moveCube) {
    const cp = new Array(8);
    const co = new Array(8);
    const ep = new Array(12);
    const eo = new Array(12);

    for (let i = 0; i < 8; i += 1) {
      const source = moveCube.cp[i];
      cp[i] = this.cp[source];
      co[i] = (this.co[source] + moveCube.co[i]) % 3;
    }

    for (let i = 0; i < 12; i += 1) {
      const source = moveCube.ep[i];
      ep[i] = this.ep[source];
      eo[i] = (this.eo[source] + moveCube.eo[i]) % 2;
    }

    return new CubieCube(cp, co, ep, eo);
  }

  applyMove(moveIndex) {
    const next = this.multiply(MOVE_CUBES[moveIndex]);
    this.cp = next.cp;
    this.co = next.co;
    this.ep = next.ep;
    this.eo = next.eo;
    return this;
  }

  applyMoves(moves) {
    for (const move of moves) {
      this.applyMove(typeof move === "number" ? move : parseMoveName(move));
    }
    return this;
  }

  isSolved() {
    for (let i = 0; i < 8; i += 1) {
      if (this.cp[i] !== i || this.co[i] !== 0) return false;
    }
    for (let i = 0; i < 12; i += 1) {
      if (this.ep[i] !== i || this.eo[i] !== 0) return false;
    }
    return true;
  }

  validate() {
    const errors = [];
    if (!isPermutation(this.cp, 8)) errors.push("Invalid corner permutation.");
    if (!isPermutation(this.ep, 12)) errors.push("Invalid edge permutation.");

    const twist = this.co.reduce((sum, value) => sum + value, 0);
    const flip = this.eo.reduce((sum, value) => sum + value, 0);
    if (twist % 3 !== 0) errors.push("Corner orientation sum is not divisible by 3.");
    if (flip % 2 !== 0) errors.push("Edge orientation sum is not even.");
    if (permutationParity(this.cp) !== permutationParity(this.ep)) {
      errors.push("Corner and edge permutation parity differ.");
    }

    return {
      ok: errors.length === 0,
      errors
    };
  }
}

export const MOVE_CUBES = Object.freeze(buildMoveCubes());

export function parseMoveName(name) {
  const normalized = String(name).trim();
  const index = MOVE_NAMES.indexOf(normalized);
  if (index === -1) {
    throw new Error(`Unknown move: ${name}`);
  }
  return index;
}

export function moveToString(moveIndex) {
  return MOVE_NAMES[moveIndex] ?? "?";
}

export function movesToString(moves) {
  return moves.map(moveToString).join(" ");
}

export function parseAlgorithm(text) {
  if (!text.trim()) return [];
  return text.trim().split(/\s+/).map(parseMoveName);
}

export function inverseMoveIndex(moveIndex) {
  const face = Math.floor(moveIndex / 3);
  const power = moveIndex % 3;
  return face * 3 + (power === 0 ? 2 : power === 1 ? 1 : 0);
}

export function invertMoves(moves) {
  return Array.from(moves).reverse().map(inverseMoveIndex);
}

function buildMoveCubes() {
  const moves = [];
  const base = BASE_MOVES.map((move) => new CubieCube(move.cp, move.co, move.ep, move.eo));

  for (let face = 0; face < 6; face += 1) {
    let current = CubieCube.identity();
    for (let power = 0; power < 3; power += 1) {
      current = current.multiply(base[face]);
      moves.push(current);
    }
  }

  return moves;
}

function isPermutation(values, size) {
  const seen = new Array(size).fill(false);
  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || value >= size || seen[value]) return false;
    seen[value] = true;
  }
  return true;
}

function permutationParity(values) {
  let parity = 0;
  for (let i = 0; i < values.length - 1; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (values[i] > values[j]) parity ^= 1;
    }
  }
  return parity;
}

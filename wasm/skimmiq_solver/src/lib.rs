#![allow(static_mut_refs)]

use std::collections::{HashMap, HashSet};
use std::mem;
use std::slice;

const INPUT_MAGIC: u32 = 0x5149_4d53; // SMIQ, little-endian
const OUTPUT_MAGIC: u32 = 0x524f_4d53; // SMOR, little-endian
const STATUS_NOT_FOUND: u32 = 0;
const STATUS_SOLVED: u32 = 1;
const METHOD_NONE: u32 = 0;
const METHOD_MITM: u32 = 1;
const METHOD_MACRO: u32 = 2;

type Key = [u16; 9];

#[derive(Clone)]
struct Move {
    cycle: Vec<usize>,
    direction: i8,
    axis: u8,
    inverse: usize,
}

struct Face {
    indexes: Vec<usize>,
}

#[derive(Clone, Copy)]
struct Tier {
    max_depth: usize,
    width: usize,
    restarts: usize,
}

struct Input {
    colors: Vec<u8>,
    solved_colors: Vec<u8>,
    moves: Vec<Move>,
    faces: Vec<Face>,
    table_depth: usize,
    forward_depth: usize,
    tiers: Vec<Tier>,
}

#[derive(Clone, Copy, Default)]
struct PathBits {
    bits: u64,
    len: u8,
}

impl PathBits {
    fn append(self, move_index: usize) -> Self {
        Self {
            bits: self.bits | ((move_index as u64) << (self.len as u64 * 5)),
            len: self.len + 1,
        }
    }

    fn prepend(self, move_index: usize) -> Self {
        Self {
            bits: (self.bits << 5) | move_index as u64,
            len: self.len + 1,
        }
    }

    fn to_vec(self) -> Vec<u8> {
        let mut moves = Vec::with_capacity(self.len as usize);
        for index in 0..self.len {
            moves.push(((self.bits >> (index as u64 * 5)) & 31) as u8);
        }
        moves
    }
}

#[derive(Clone)]
struct TableEntry {
    colors: Vec<u8>,
    path: PathBits,
    last_move: Option<usize>,
}

struct ExactEntry {
    colors: Vec<u8>,
    path: PathBits,
    last_move: Option<usize>,
}

struct Operation {
    moves: Vec<usize>,
    path: Vec<u8>,
    is_raw: bool,
    last_move: usize,
}

struct BeamEntry {
    colors: Vec<u8>,
    path: Vec<u8>,
    last_move: Option<usize>,
    score: i32,
    rank_score: i32,
}

static mut RESULT: Vec<u8> = Vec::new();

#[no_mangle]
pub extern "C" fn skimmiq_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let pointer = buffer.as_mut_ptr();
    mem::forget(buffer);
    pointer
}

#[no_mangle]
pub extern "C" fn skimmiq_dealloc(pointer: *mut u8, len: usize) {
    if pointer.is_null() {
        return;
    }
    unsafe {
        let _ = Vec::from_raw_parts(pointer, 0, len);
    }
}

#[no_mangle]
pub extern "C" fn skimmiq_result_ptr() -> *const u8 {
    unsafe { RESULT.as_ptr() }
}

#[no_mangle]
pub extern "C" fn skimmiq_result_len() -> usize {
    unsafe { RESULT.len() }
}

#[no_mangle]
pub extern "C" fn skimmiq_solve(pointer: *const u8, len: usize) -> u32 {
    if pointer.is_null() || len == 0 {
        write_output(STATUS_NOT_FOUND, METHOD_NONE, 0, &[]);
        return STATUS_NOT_FOUND;
    }

    let input_bytes = unsafe { slice::from_raw_parts(pointer, len) };
    let Some(input) = parse_input(input_bytes) else {
        write_output(STATUS_NOT_FOUND, METHOD_NONE, 0, &[]);
        return STATUS_NOT_FOUND;
    };

    let mut nodes = 0_u64;
    let result = solve_input(&input, &mut nodes);
    match result {
        Some((method, moves)) => {
            write_output(STATUS_SOLVED, method, nodes, &moves);
            STATUS_SOLVED
        }
        None => {
            write_output(STATUS_NOT_FOUND, METHOD_MACRO, nodes, &[]);
            STATUS_NOT_FOUND
        }
    }
}

fn solve_input(input: &Input, nodes: &mut u64) -> Option<(u32, Vec<u8>)> {
    if is_solved(&input.colors, &input.faces) {
        return Some((METHOD_NONE, Vec::new()));
    }

    let table = build_reverse_table(input, nodes);
    if let Some(moves) = meet_in_middle(input, &table, nodes) {
        return Some((METHOD_MITM, moves));
    }

    let operations = build_operations(input);
    for tier in &input.tiers {
        if let Some(moves) = macro_beam(input, &table, &operations, *tier, nodes) {
            return Some((METHOD_MACRO, moves));
        }
    }

    None
}

fn build_reverse_table(input: &Input, nodes: &mut u64) -> HashMap<Key, PathBits> {
    let mut states = HashMap::new();
    states.insert(state_key(&input.solved_colors), PathBits::default());
    let mut frontier = vec![TableEntry {
        colors: input.solved_colors.clone(),
        path: PathBits::default(),
        last_move: None,
    }];

    for _ in 0..input.table_depth {
        let mut next = Vec::new();
        for entry in frontier {
            for move_index in 0..input.moves.len() {
                if is_immediate_inverse(input, entry.last_move, move_index) {
                    continue;
                }
                let mut colors = entry.colors.clone();
                apply_move(&mut colors, &input.moves[move_index]);
                *nodes += 1;

                let key = state_key(&colors);
                if states.contains_key(&key) {
                    continue;
                }

                let inverse = input.moves[move_index].inverse;
                let path = entry.path.prepend(inverse);
                states.insert(key, path);
                next.push(TableEntry {
                    colors,
                    path,
                    last_move: Some(move_index),
                });
            }
        }
        frontier = next;
    }

    states
}

fn meet_in_middle(
    input: &Input,
    table: &HashMap<Key, PathBits>,
    nodes: &mut u64,
) -> Option<Vec<u8>> {
    let start_key = state_key(&input.colors);
    if let Some(path) = table.get(&start_key) {
        return Some(path.to_vec());
    }

    let mut seen = HashSet::new();
    seen.insert(start_key);
    let mut frontier = vec![ExactEntry {
        colors: input.colors.clone(),
        path: PathBits::default(),
        last_move: None,
    }];

    for _ in 0..input.forward_depth {
        let mut next = Vec::new();
        for entry in frontier {
            for move_index in 0..input.moves.len() {
                if is_immediate_inverse(input, entry.last_move, move_index) {
                    continue;
                }

                let mut colors = entry.colors.clone();
                apply_move(&mut colors, &input.moves[move_index]);
                *nodes += 1;

                let key = state_key(&colors);
                if seen.contains(&key) {
                    continue;
                }

                let path = entry.path.append(move_index);
                if let Some(suffix) = table.get(&key) {
                    let mut moves = path.to_vec();
                    moves.extend(suffix.to_vec());
                    return Some(moves);
                }

                seen.insert(key);
                next.push(ExactEntry {
                    colors,
                    path,
                    last_move: Some(move_index),
                });
            }
        }
        frontier = next;
    }

    None
}

fn macro_beam(
    input: &Input,
    table: &HashMap<Key, PathBits>,
    operations: &[Operation],
    tier: Tier,
    nodes: &mut u64,
) -> Option<Vec<u8>> {
    let seed_base = hash_colors(&input.colors);

    for restart in 0..tier.restarts {
        let mut rng = Mulberry32::new(seed_base.wrapping_add((restart as u32).wrapping_mul(0x9e37_79b9)));
        let jitter = if restart == 0 {
            0
        } else {
            120 + restart as i32 * 60
        };
        let initial_score = score_state(&input.colors, input);
        let mut beam = vec![BeamEntry {
            colors: input.colors.clone(),
            path: Vec::new(),
            last_move: None,
            score: initial_score,
            rank_score: initial_score,
        }];

        for _depth in 0..tier.max_depth {
            let mut candidates = Vec::new();
            let mut layer_seen = HashSet::new();

            for entry in &beam {
                for operation in operations {
                    if operation.is_raw
                        && entry
                            .last_move
                            .is_some_and(|last| input.moves[operation.moves[0]].inverse == last)
                    {
                        continue;
                    }

                    let mut colors = entry.colors.clone();
                    for move_index in &operation.moves {
                        apply_move(&mut colors, &input.moves[*move_index]);
                    }
                    *nodes += 1;

                    let key = state_key(&colors);
                    if !layer_seen.insert(key) {
                        continue;
                    }

                    let mut path = entry.path.clone();
                    path.extend(&operation.path);

                    if let Some(suffix) = table.get(&key) {
                        path.extend(suffix.to_vec());
                        return Some(path);
                    }

                    if is_solved(&colors, &input.faces) {
                        return Some(path);
                    }

                    let score = score_state(&colors, input) + path.len() as i32 * 15;
                    let rank_score = score + jitter_sample(&mut rng, jitter);
                    candidates.push(BeamEntry {
                        colors,
                        path,
                        last_move: Some(operation.last_move),
                        score,
                        rank_score,
                    });
                }
            }

            if candidates.is_empty() {
                break;
            }

            candidates.sort_unstable_by(|left, right| {
                left.rank_score
                    .cmp(&right.rank_score)
                    .then_with(|| left.path.len().cmp(&right.path.len()))
                    .then_with(|| left.score.cmp(&right.score))
            });
            candidates.truncate(tier.width);
            beam = candidates;
        }
    }

    None
}

fn build_operations(input: &Input) -> Vec<Operation> {
    let mut operations = Vec::new();
    for index in 0..input.moves.len() {
        operations.push(Operation {
            moves: vec![index],
            path: vec![index as u8],
            is_raw: true,
            last_move: index,
        });
    }

    let mut seen = HashSet::new();
    for first_index in 0..input.moves.len() {
        for second_index in 0..input.moves.len() {
            let first = &input.moves[first_index];
            let second = &input.moves[second_index];
            if first.axis == second.axis {
                continue;
            }

            let first_inverse = first.inverse;
            let second_inverse = second.inverse;
            let moves = vec![first_index, second_index, first_inverse, second_inverse];
            let key = operation_permutation_key(input, &moves);
            if !seen.insert(key) {
                continue;
            }

            operations.push(Operation {
                moves: moves.clone(),
                path: moves.iter().map(|index| *index as u8).collect(),
                is_raw: false,
                last_move: second_inverse,
            });
        }
    }

    operations
}

fn operation_permutation_key(input: &Input, moves: &[usize]) -> Vec<u8> {
    let mut permutation: Vec<u8> = (0..input.colors.len()).map(|index| index as u8).collect();
    for move_index in moves {
        let mv = &input.moves[*move_index];
        let previous = permutation.clone();
        let len = mv.cycle.len();
        for index in 0..len {
            let from = mv.cycle[index];
            let to_position = if mv.direction > 0 {
                (index + 1) % len
            } else {
                (index + len - 1) % len
            };
            let to = mv.cycle[to_position];
            permutation[to] = previous[from];
        }
    }
    permutation
}

fn apply_move(colors: &mut [u8], mv: &Move) {
    let cycle = &mv.cycle;
    if cycle.is_empty() {
        return;
    }

    if mv.direction > 0 {
        let saved = colors[*cycle.last().unwrap()];
        for index in (1..cycle.len()).rev() {
            colors[cycle[index]] = colors[cycle[index - 1]];
        }
        colors[cycle[0]] = saved;
    } else {
        let saved = colors[cycle[0]];
        for index in 0..cycle.len() - 1 {
            colors[cycle[index]] = colors[cycle[index + 1]];
        }
        colors[*cycle.last().unwrap()] = saved;
    }
}

fn is_solved(colors: &[u8], faces: &[Face]) -> bool {
    for face in faces {
        if face.indexes.is_empty() {
            continue;
        }
        let first = colors[face.indexes[0]];
        if face.indexes.iter().any(|index| colors[*index] != first) {
            return false;
        }
    }
    true
}

fn is_immediate_inverse(input: &Input, previous: Option<usize>, move_index: usize) -> bool {
    previous.is_some_and(|previous| input.moves[move_index].inverse == previous)
}

fn score_state(colors: &[u8], input: &Input) -> i32 {
    let mut disorder = 0_i32;
    let mut unique_penalty = 0_i32;
    let mut solved_faces = 0_i32;
    let mut tail_concentration = 0_i32;
    let mut worst_face = 0_i32;
    let mut pair_bonus = 0_i32;

    for face in &input.faces {
        let mut counts = [0_i32; 6];
        for index in &face.indexes {
            counts[colors[*index] as usize] += 1;
        }

        let mut best = 0_i32;
        let mut unique = 0_i32;
        for count in counts {
            if count > 0 {
                unique += 1;
                best = best.max(count);
                pair_bonus += count * count;
            }
        }

        let miss = face.indexes.len() as i32 - best;
        worst_face = worst_face.max(miss);
        disorder += miss;
        unique_penalty += (unique - 1).max(0);
        if miss == 0 {
            solved_faces += 1;
        }

        for count in counts {
            if count > 0 && count != best {
                tail_concentration += count * count;
            }
        }
    }

    disorder * 1200
        + worst_face * 250
        + unique_penalty * 250
        - solved_faces * 1200
        - tail_concentration * 10
        - pair_bonus * 2
}

fn state_key(colors: &[u8]) -> Key {
    let mut key = [0_u16; 9];
    for (group, slot) in key.iter_mut().enumerate() {
        let mut value = 0_u16;
        let mut multiplier = 1_u16;
        for offset in 0..6 {
            let index = group * 6 + offset;
            if index >= colors.len() {
                break;
            }
            value += colors[index] as u16 * multiplier;
            multiplier *= 6;
        }
        *slot = value;
    }
    key
}

fn hash_colors(colors: &[u8]) -> u32 {
    let mut hash = 2_166_136_261_u32;
    for color in colors {
        hash ^= *color as u32 + 31;
        hash = hash.wrapping_mul(16_777_619);
    }
    hash
}

fn jitter_sample(rng: &mut Mulberry32, jitter: i32) -> i32 {
    if jitter == 0 {
        return 0;
    }
    let span = (jitter * 2 + 1) as u32;
    rng.next() as i32 % span as i32 - jitter
}

struct Mulberry32 {
    value: u32,
}

impl Mulberry32 {
    fn new(seed: u32) -> Self {
        Self { value: seed }
    }

    fn next(&mut self) -> u32 {
        self.value = self.value.wrapping_add(0x6d2b_79f5);
        let mut next = self.value;
        next = (next ^ (next >> 15)).wrapping_mul(next | 1);
        next ^= next.wrapping_add((next ^ (next >> 7)).wrapping_mul(next | 61));
        next ^ (next >> 14)
    }
}

fn parse_input(bytes: &[u8]) -> Option<Input> {
    let mut reader = Reader { bytes, offset: 0 };
    if reader.u32()? != INPUT_MAGIC {
        return None;
    }

    let sticker_count = reader.u32()? as usize;
    let move_count = reader.u32()? as usize;
    let mut moves = Vec::with_capacity(move_count);
    for _ in 0..move_count {
        let direction = if reader.u32()? == 0 { -1 } else { 1 };
        let axis = reader.u32()? as u8;
        let inverse = reader.u32()? as usize;
        let cycle_len = reader.u32()? as usize;
        let mut cycle = Vec::with_capacity(cycle_len);
        for _ in 0..cycle_len {
            cycle.push(reader.u32()? as usize);
        }
        moves.push(Move {
            cycle,
            direction,
            axis,
            inverse,
        });
    }

    let face_count = reader.u32()? as usize;
    let mut faces = Vec::with_capacity(face_count);
    for _ in 0..face_count {
        let len = reader.u32()? as usize;
        let mut indexes = Vec::with_capacity(len);
        for _ in 0..len {
            indexes.push(reader.u32()? as usize);
        }
        faces.push(Face { indexes });
    }

    let colors_len = reader.u32()? as usize;
    if colors_len != sticker_count {
        return None;
    }
    let colors = reader.bytes(colors_len)?.to_vec();

    let solved_len = reader.u32()? as usize;
    if solved_len != sticker_count {
        return None;
    }
    let solved_colors = reader.bytes(solved_len)?.to_vec();

    let table_depth = reader.u32()? as usize;
    let forward_depth = reader.u32()? as usize;
    let tier_count = reader.u32()? as usize;
    let mut tiers = Vec::with_capacity(tier_count);
    for _ in 0..tier_count {
        tiers.push(Tier {
            max_depth: reader.u32()? as usize,
            width: reader.u32()? as usize,
            restarts: reader.u32()? as usize,
        });
    }

    Some(Input {
        colors,
        solved_colors,
        moves,
        faces,
        table_depth,
        forward_depth,
        tiers,
    })
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn u32(&mut self) -> Option<u32> {
        let end = self.offset.checked_add(4)?;
        let chunk = self.bytes.get(self.offset..end)?;
        self.offset = end;
        Some(u32::from_le_bytes(chunk.try_into().ok()?))
    }

    fn bytes(&mut self, len: usize) -> Option<&'a [u8]> {
        let end = self.offset.checked_add(len)?;
        let chunk = self.bytes.get(self.offset..end)?;
        self.offset = end;
        Some(chunk)
    }
}

fn write_output(status: u32, method: u32, nodes: u64, moves: &[u8]) {
    let mut output = Vec::with_capacity(24 + moves.len() * 4);
    push_u32(&mut output, OUTPUT_MAGIC);
    push_u32(&mut output, status);
    push_u32(&mut output, method);
    push_u32(&mut output, nodes as u32);
    push_u32(&mut output, (nodes >> 32) as u32);
    push_u32(&mut output, moves.len() as u32);
    for move_index in moves {
        push_u32(&mut output, *move_index as u32);
    }
    unsafe {
        RESULT = output;
    }
}

fn push_u32(output: &mut Vec<u8>, value: u32) {
    output.extend(value.to_le_bytes());
}

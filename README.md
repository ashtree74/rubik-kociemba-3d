# Rubik + SkimmIQ 3D Solvers

Interactive 3D puzzle playground with two browser-based solvers:

- a Rubik-style 3D cube page
- a SkimmIQ-inspired 3D tape puzzle page with a Rust + WebAssembly solver

The app is built with Vite, Three.js, plain JavaScript, and a custom Rust/WASM module for the SkimmIQ solver.

## Live Pages

When running locally:

- Rubik cube: `http://127.0.0.1:5173/`
- SkimmIQ solver: `http://127.0.0.1:5173/skimmiq.html`

## What Is SkimmIQ?

SkimmIQ is a twisty/sliding color puzzle built around continuous "tapes" of stickers. A move shifts colors along a band that wraps through four visible faces of the cube. The solved goal is simple to state: every visible face should become a single uniform color.

This repository includes an independent, fan-made SkimmIQ-style implementation. It is not affiliated with the official SkimmIQ project.

Original SkimmIQ site: https://skimmiq.com

## Features

- Real-time 3D rendering with Three.js
- Interactive Rubik-style cube controls
- Separate SkimmIQ page with layouts, difficulties, tape moves, scramble, reset, and solve
- Smooth SkimmIQ tape animation with bending over cube edges
- Solver progress and move sequence display
- Rust + WebAssembly SkimmIQ solver loaded by a Web Worker
- Unit tests for puzzle mechanics and solver behavior

## SkimmIQ Solver Overview

The SkimmIQ solver works from the current color state, not from the scramble history.

At a high level:

- each puzzle state is treated as a node in a graph
- legal tape moves are graph edges
- solved states are generated from the face-color constraints
- the Rust/WASM solver searches for a legal move sequence back to a solved state
- it uses a meet-in-the-middle search first, then macro/beam-style search tiers for larger states

The browser receives only the final sequence of legal moves and animates them on the 3D puzzle.

## Project Structure

```text
.
|-- index.html                  # Rubik page
|-- skimmiq.html                # SkimmIQ page
|-- src/
|   |-- main.js                 # Rubik UI and rendering
|   |-- cube.js                 # Rubik cube model/render helpers
|   |-- solver.js               # Rubik solver logic
|   |-- skimmiq-model.js        # SkimmIQ state model, tapes, moves, validation
|   |-- skimmiq-page.js         # SkimmIQ UI and 3D rendering
|   |-- skimmiq-worker.js       # Worker wrapper for SkimmIQ solving
|   |-- skimmiq-wasm.js         # JS/WASM bridge
|   `-- wasm/skimmiq_solver.wasm
|-- wasm/skimmiq_solver/        # Rust source for the WASM solver
|-- scripts/build-wasm.mjs      # Builds and copies the WASM artifact
`-- tests/                      # Model and solver tests
```

## Development

Install dependencies:

```bash
npm install
```

Start the local dev server:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Build the frontend:

```bash
npm run build
```

Build the SkimmIQ Rust/WASM solver:

```bash
npm run build:wasm
```

The WASM build requires Rust, Cargo, and the `wasm32-unknown-unknown` target.

## Notes

- `package.json` is marked private to avoid accidental npm publishing.
- The SkimmIQ mechanics and solver in this repo are custom implementations.
- The official SkimmIQ project is available at https://skimmiq.com.

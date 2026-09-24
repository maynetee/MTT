# Contributing

Thanks for helping improve MTT Tournament Director.

## Setup

- Node.js 24 LTS (see `.nvmrc`) and npm
- Rust through rustup: `rust-toolchain.toml` pins the version with `rustfmt`, `clippy` and the
  `wasm32-unknown-unknown` target, installed the first time you run `cargo` in the repository
  (or with `rustup toolchain install`)
- wasm-pack for the WebAssembly engine: `cargo install wasm-pack --locked`
- The [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

```bash
npm ci
npm run tauri dev   # desktop app
npm run dev         # browser demo only
```

`npm run wasm` builds `crates/mtt-wasm` into `src/wasm/pkg`; `dev`, `build`, `build:pages`,
`typecheck` and `test` rebuild it first when it is missing or older than the Rust sources.

`npm run build:pages` builds the browser demo published on GitHub Pages: served under `/MTT/`,
with a Content-Security-Policy `<meta>`. `npx vite preview --mode pages` serves it at
http://localhost:4173/MTT/.

Set `MTT_DATA_DIR` to a throwaway directory (`MTT_DATA_DIR=/tmp/mtt-dev npm run tauri dev`) to keep development data apart from your real tournaments.

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run build
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
```

CI runs the same checks on every pull request. `cargo test` regenerates the TypeScript types in
`src/bindings/` from the Rust code: commit them with your change, CI fails when they drift.

[docs/architecture.md](docs/architecture.md) explains how the pieces fit together and lists the
steps to add a new command.

## Guidelines

- One topic per pull request, linked to an issue (`Closes #123`).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`fix:`, `feat:`, `docs:`, …).
- Bug fixes come with a regression test.
- Tournament rules follow the [TDA rules](https://www.pokertda.com/) unless a setting says otherwise; mention the rule number when a change depends on it.
- Never commit real player data.

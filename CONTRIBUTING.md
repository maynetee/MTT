# Contributing

Thanks for helping improve MTT Tournament Director.

## Setup

- Node.js 24 LTS (see `.nvmrc`) and npm
- Rust stable with `rustfmt` and `clippy`
- The [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform
- For the browser build of the core: `rustup target add wasm32-unknown-unknown` and
  `cargo install wasm-pack --locked`

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

CI runs the same checks on every pull request.

## Guidelines

- One topic per pull request, linked to an issue (`Closes #123`).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`fix:`, `feat:`, `docs:`, …).
- Bug fixes come with a regression test.
- Tournament rules follow the [TDA rules](https://www.pokertda.com/) unless a setting says otherwise; mention the rule number when a change depends on it.
- Never commit real player data.

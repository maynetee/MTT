# Contributing

Thanks for helping improve MTT Tournament Director.

## Setup

- Node.js 24 LTS (see `.nvmrc`) and npm
- Rust stable with `rustfmt` and `clippy`
- The [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform

```bash
npm ci
npm run tauri dev   # desktop app
npm run dev         # browser demo only
```

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run build
cd src-tauri && cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test
```

CI runs the same checks on every pull request.

## Guidelines

- One topic per pull request, linked to an issue (`Closes #123`).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`fix:`, `feat:`, `docs:`, …).
- Bug fixes come with a regression test.
- Tournament rules follow the [TDA rules](https://www.pokertda.com/) unless a setting says otherwise; mention the rule number when a change depends on it.
- Never commit real player data.

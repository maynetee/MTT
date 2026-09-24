# MTT Tournament Director

[![CI](https://github.com/maynetee/MTT/actions/workflows/ci.yml/badge.svg)](https://github.com/maynetee/MTT/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A free, open-source director for live poker tournaments that runs on your own computer: clock,
registration, seating and table balancing, eliminations, ranking and a TV display.

<!-- screenshots: added in #58 -->

Try it in your browser at <https://maynetee.github.io/MTT/> (online from the 1.0 release).

## Features

### Tournament clock

- The clock is stored as a point in time ("level 4 ends at 21:40"), not as a counter that
  ticks. It never drifts, keeps running through a restart of the app, and every window shows
  the same time.
- Levels and breaks follow each other on their own. Antes can be classic or big blind ante.
- Start, pause, previous and next level, one minute more or less, jump to the next break, and
  the start time of every upcoming level.
- When the structure runs out, the last level stays on and overtime counts up: the blinds never
  change without the director. The app warns when two levels or fewer are left and once the
  structure is over, and flags an ante above the big blind or blinds that go down.
- The structure can be edited while the tournament runs: levels already played are frozen and
  the current level keeps its elapsed time.

### Registration and late registration

- Register players by name (the same name twice is refused, whatever the case). Each player is
  seated at once by a random draw at the table with the fewest players, or at a seat you choose.
- Late registration closes at the end of a given play level (optionally through the break that
  follows), after a given playing time, or when you close it. You can close or reopen it at any
  time; the remaining time is shown while it is open.
- Players can be unregistered until the tournament starts.

### Seating and table balancing

Seating follows the practice of the [TDA rules](https://www.pokertda.com/):

- Each table has a dealer button, and the app shows who posts the next small and big blind
  (heads-up included).
- When the largest and the smallest table differ by two players or more (configurable), the app
  proposes moves: the player due for the big blind at the largest table goes to the worst
  position at the smallest table. You confirm each move. A table whose button is unknown is
  pointed out instead of guessed.
- A table break is suggested as soon as the other tables can seat everyone; its players are
  dealt at random to the tables with the fewest players.
- Final table: every remaining player is redrawn to a random seat at the final table and the
  other tables close.
- Players can also be moved by hand to any free seat, and more tables opened.

### Eliminations and ranking

- Eliminate one player, or several in the same hand: the player who started the hand with more
  chips finishes higher, and equal stacks tie and share the place.
- Live ranking with ties, provisional places while players can still come in, places paid,
  bubble and in-the-money status.
- A wrong elimination that can no longer be undone can be corrected.
- The tournament ends by itself when one player is left and no one else can enter.

### Undo and redo

Every action can be undone and redone: registrations, eliminations, moves, clock changes,
settings. The buttons say what they will undo or redo.

### TV display

- A second window for the room: level, blinds and ante, clock, next level, next break, players
  left, average stack (also in big blinds), active tables, places paid, bubble and live ranking.
- On the desktop it opens fullscreen on the second screen when there is one; Esc closes it.
  In the browser it opens in a new tab. It follows every change made in the director window.

### Exports

- The ranking as CSV (UTF-8, opens correctly in Excel) or PDF. The PDF embeds the Inter font,
  so names with accented Latin, Greek or Cyrillic letters print as typed.
- The desktop app asks where to save the file; the browser downloads it.

### Tournaments and data

- As many tournaments as you like: create, open and delete them from the list.
- Import from the previous version: on a fresh install, if the desktop app finds a tournament
  left by the previous version of MTT Tournament Director, it offers to import it (structure,
  players, seats, eliminations and clock). The old database is only read, never changed.

### Money (coming in 1.0)

The engine already handles the following; the screens to use them are coming in 1.0:

- Buy-in split into prize and fee, in the currency of your choice; prize pool, guarantee and
  overlay.
- Re-entries, rebuys and add-ons, each with its price, stack, limit per player and availability
  window.
- Payout structures: places paid as a number or a share of the entries; amounts from a curve,
  custom percentages or fixed amounts; rounding and minimum cash; payouts can be locked. Tied
  players share the prizes of the places they cover.
- ICM and chip-chop deal calculator, and recording a deal with an amount left to play for.

### Languages

English and French. The app speaks French when the first language of the system it knows is
French, English otherwise; Preferences switches it for this computer, and an open display
follows at once.

### Privacy

Everything stays on your computer: no account, no server, no telemetry. The desktop app keeps
all tournaments in one SQLite file, `mtt.sqlite`, in its data folder:

| System  | Data folder                                                              |
| ------- | ------------------------------------------------------------------------ |
| macOS   | `~/Library/Application Support/com.maynetee.mtt`                         |
| Windows | `%APPDATA%\com.maynetee.mtt`                                             |
| Linux   | `~/.local/share/com.maynetee.mtt` (or `$XDG_DATA_HOME/com.maynetee.mtt`) |

To back up your tournaments, copy that file while the app is closed.

## Download and install

Installers are attached to each release on the
[Releases page](https://github.com/maynetee/MTT/releases):

| System                                | File                                       |
| ------------------------------------- | ------------------------------------------ |
| macOS (Apple silicon and Intel)       | `.dmg` (universal)                         |
| Windows (x64)                         | `-setup.exe` installer, or `.msi`          |
| Linux (x64)                           | `.AppImage`, or `.deb` for Debian/Ubuntu   |

### The builds are not code-signed yet

Your system will warn you the first time you open the app.

**macOS 15 (Sequoia) and later.** Control-click › Open no longer bypasses Gatekeeper.

1. Open the app once. macOS refuses to open it: click **Done**.
2. Open **System Settings › Privacy & Security**, scroll down to the message about
   MTT Tournament Director and click **Open Anyway**, then confirm.

If macOS still refuses, remove the quarantine flag in Terminal:

```sh
xattr -dr com.apple.quarantine "/Applications/MTT Tournament Director.app"
```

**Windows.** If SmartScreen shows "Windows protected your PC", click **More info**, then
**Run anyway**.

**Linux.** Make the AppImage executable, then run it:

```sh
chmod +x MTT*.AppImage
./MTT*.AppImage
```

On Ubuntu 24.04, AppImages need FUSE 2: `sudo apt install libfuse2t64`.

## Browser demo

<https://maynetee.github.io/MTT/> runs the same engine as the desktop app, compiled to
WebAssembly, directly in the page. Nothing is sent to a server: tournaments are saved in your
browser's storage for that site, so they stay in that browser only and disappear if you clear
its site data. The import from the previous version is only available in the desktop app. For
a real event, prefer the desktop app, which keeps your tournaments in a file you can back up.

## Keyboard shortcuts

| Keys                                  | Action                  | Where                                   |
| ------------------------------------- | ----------------------- | --------------------------------------- |
| ⌘Z or Ctrl+Z                          | Undo                    | Tournament screens, outside text fields |
| ⇧⌘Z, Ctrl+Shift+Z or Ctrl+Y           | Redo                    | Tournament screens, outside text fields |
| ⌘F or Ctrl+F                          | Search the players      | Players tab                             |
| Enter                                 | Register the name typed | Registration tab                        |
| Esc                                   | Close the display       | Display window                          |

## Build from source

Prerequisites:

- [Node.js](https://nodejs.org/) 24 LTS (the version in [`.nvmrc`](.nvmrc): `nvm use`) and npm.
- [Rust](https://rustup.rs/) through rustup: [`rust-toolchain.toml`](rust-toolchain.toml) pins
  the version, with rustfmt, clippy and the `wasm32-unknown-unknown` target. rustup installs it
  the first time you run `cargo` in the repository (or run `rustup toolchain install`).
- [wasm-pack](https://github.com/drager/wasm-pack) for the WebAssembly engine:
  `cargo install wasm-pack --locked`.
- For the desktop app, the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
  of your system.

```sh
npm ci                    # install the JavaScript dependencies
npm run tauri dev         # desktop app, reloads on change
npm run dev               # browser build only, at http://localhost:1420
npm test                  # front-end tests (Vitest), core scenarios through WebAssembly included
cargo test --workspace    # Rust tests; also regenerates the TypeScript types in src/bindings
npm run tauri build       # installers for your system, in target/release/bundle
```

`npm run wasm` builds the WebAssembly engine into `src/wasm/pkg`; `dev`, `build`, `typecheck`
and `test` rebuild it first when it is missing or older than the Rust sources.

During development, point the desktop app at a throwaway data folder so your real tournaments
stay untouched:

```sh
MTT_DATA_DIR=/tmp/mtt-dev npm run tauri dev
```

In PowerShell: `$env:MTT_DATA_DIR = "$env:TEMP\mtt-dev"; npm run tauri dev`.

## Architecture

- `crates/mtt-core`: the tournament rules in pure, deterministic Rust. Every action is a command
  turned into one recorded event; the state is rebuilt by replaying the events, which gives undo
  and redo. No I/O, no clock, no randomness of its own.
- `src-tauri`: the desktop host. Runs the core behind Tauri commands and keeps each tournament's
  event log in SQLite.
- `crates/mtt-wasm`: the browser host. The same core compiled to WebAssembly, logs kept in
  `localStorage`.
- `src`: the React and TypeScript interface. It talks to either host through one `Engine`
  interface (`src/engine`), with types generated from the Rust code (`src/bindings`).

Details for contributors: [docs/architecture.md](docs/architecture.md) and the core
specification, [docs/design/core-spec.md](docs/design/core-spec.md).

## Contributing

Bug reports, ideas and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Mendel Teichman

## Credits

- [Inter](https://github.com/rsms/inter) by The Inter Project Authors, under the
  [SIL Open Font License 1.1](src/assets/fonts/OFL.txt), for the interface and the PDF exports.
- Seating, balancing and ranking follow the rules of the
  [Poker Tournament Directors Association](https://www.pokertda.com/). This project is not
  affiliated with the TDA.

// Builds crates/mtt-wasm into src/wasm/pkg with wasm-pack (release, size-optimized).
//
//   node scripts/wasm.mjs               always build (`npm run wasm`)
//   node scripts/wasm.mjs --if-stale    build only when the package is missing or older than
//                                       the Rust sources (the predev/prebuild/pretest hooks)
//
// A Node script rather than an inline `VAR=value cmd` so that it also runs on Windows.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src", "wasm", "pkg");
const output = join(outDir, "mtt_wasm_bg.wasm");
const sources = [
  join(root, "Cargo.toml"),
  join(root, "Cargo.lock"),
  join(root, "crates", "mtt-core"),
  join(root, "crates", "mtt-wasm")
];

function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(path)) {
    if (entry === "target" || entry.startsWith(".")) continue;
    newest = Math.max(newest, newestMtime(join(path, entry)));
  }
  return newest;
}

function isStale() {
  if (!existsSync(output) || !existsSync(join(outDir, "mtt_wasm.js"))) return true;
  const built = statSync(output).mtimeMs;
  return sources.some((source) => newestMtime(source) > built);
}

if (process.argv.includes("--if-stale") && !isStale()) {
  process.exit(0);
}

const result = spawnSync(
  "wasm-pack",
  ["build", "crates/mtt-wasm", "--target", "web", "--out-dir", "../../src/wasm/pkg", "--release"],
  {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, CARGO_PROFILE_RELEASE_OPT_LEVEL: "z" }
  }
);

if (result.error?.code === "ENOENT") {
  console.error(
    "wasm-pack is required to build the browser engine (src/wasm/pkg).\n" +
      "Install it with `cargo install wasm-pack --locked` and add the target with\n" +
      "`rustup target add wasm32-unknown-unknown`, then run `npm run wasm`."
  );
  process.exit(1);
}
process.exit(result.status ?? 1);

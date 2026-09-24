/// <reference types="vitest/config" />
import { defineConfig, type Plugin, type Rolldown } from "vite";
import react from "@vitejs/plugin-react";

const INITIAL_LOAD_BUDGET_KB = 500;

/** `vite build --mode pages`: the browser demo, served by GitHub Pages under /MTT/. */
const PAGES_MODE = "pages";
const PAGES_BASE = "/MTT/";

/**
 * Content Security Policy of the browser demo. GitHub Pages cannot send headers, so it goes in
 * a <meta>. 'wasm-unsafe-eval' lets the page compile the engine's WebAssembly module; styles
 * allow the inline `style` attributes React sets.
 */
const PAGES_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'"
].join("; ");

/**
 * Adds the CSP <meta> right after the charset declaration, before any script or stylesheet it
 * must cover. Build only: the dev server injects inline scripts.
 */
function contentSecurityPolicy(policy: string): Plugin {
  return {
    name: "mtt:content-security-policy",
    apply: "build",
    transformIndexHtml(html) {
      const charset = /<meta charset="[^"]*"\s*\/?>/i;
      if (!charset.test(html)) throw new Error("index.html needs a <meta charset> for the CSP <meta> to follow");
      return html.replace(charset, (tag) => `${tag}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    }
  };
}

/**
 * Warns when a chunk loaded at startup (an entry chunk or one of its static imports)
 * exceeds the budget. Vite's own chunkSizeWarningLimit applies to every chunk and has
 * to be raised for the lazily loaded fontkit chunk, so this keeps the stricter budget
 * where it matters.
 */
function initialLoadBudget(limitKb: number): Plugin {
  return {
    name: "mtt:initial-load-budget",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = new Map<string, Rolldown.OutputChunk>();
      for (const output of Object.values(bundle)) {
        if (output.type === "chunk") chunks.set(output.fileName, output);
      }
      const initial = new Set<string>();
      const visit = (fileName: string) => {
        if (initial.has(fileName)) return;
        initial.add(fileName);
        chunks.get(fileName)?.imports.forEach(visit);
      };
      for (const chunk of chunks.values()) {
        if (chunk.isEntry) visit(chunk.fileName);
      }
      for (const fileName of initial) {
        const sizeKb = Buffer.byteLength(chunks.get(fileName)?.code ?? "") / 1000;
        if (sizeKb > limitKb) {
          this.warn(`${fileName} is loaded at startup and weighs ${sizeKb.toFixed(2)} kB (budget: ${limitKb} kB).`);
        }
      }
    }
  };
}

export default defineConfig(({ mode }) => ({
  // The desktop app loads from the root of its origin; the demo lives under the repository path.
  base: mode === PAGES_MODE ? PAGES_BASE : "/",
  plugins: [
    react(),
    initialLoadBudget(INITIAL_LOAD_BUDGET_KB),
    // The desktop app's CSP comes from src-tauri/tauri.conf.json.
    mode === PAGES_MODE && contentSecurityPolicy(PAGES_CSP)
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    // Only the lazily loaded fontkit chunk (about 710 kB) exceeds 500 kB: @pdf-lib/fontkit
    // ships as a single pre-bundled module that cannot be split further. Chunks loaded at
    // startup are held to INITIAL_LOAD_BUDGET_KB by the plugin above.
    chunkSizeWarningLimit: 750,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // PDF export dependencies, loaded on demand; kept apart so neither lands in the main chunk.
          groups: [
            { name: "pdf-lib", test: /node_modules[\\/](pdf-lib|@pdf-lib[\\/](standard-fonts|upng))[\\/]/, priority: 2 },
            { name: "fontkit", test: /node_modules[\\/]@pdf-lib[\\/]fontkit[\\/]/, priority: 1 }
          ]
        }
      }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true
  }
}));

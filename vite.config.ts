/// <reference types="vitest/config" />
import { defineConfig, type Plugin, type Rolldown } from "vite";
import react from "@vitejs/plugin-react";

const INITIAL_LOAD_BUDGET_KB = 500;

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

export default defineConfig({
  plugins: [react(), initialLoadBudget(INITIAL_LOAD_BUDGET_KB)],
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
});

import { createContext, useContext, type ReactNode } from "react";
import type { Engine } from "../engine/types";

const EngineContext = createContext<Engine | null>(null);

export function EngineProvider({ engine, children }: { engine: Engine; children: ReactNode }) {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

export function useEngine(): Engine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error("useEngine() needs an <EngineProvider>");
  return engine;
}

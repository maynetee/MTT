import { useEffect } from "react";

/** The window's (or browser tab's) title, kept up to date with the language. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

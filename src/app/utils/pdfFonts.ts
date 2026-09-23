import interBoldUrl from "../../assets/fonts/Inter-Bold.ttf?url";
import interRegularUrl from "../../assets/fonts/Inter-Regular.ttf?url";

/** Raw TrueType font files used to render PDFs. */
export interface PdfFontBytes {
  regular: ArrayBuffer | Uint8Array;
  bold: ArrayBuffer | Uint8Array;
}

export type PdfFontLoader = () => Promise<PdfFontBytes>;

async function fetchFont(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load the PDF font ${url} (HTTP ${response.status})`);
  }
  return response.arrayBuffer();
}

/**
 * Inter (SIL Open Font License 1.1, see src/assets/fonts/OFL.txt) covers Latin
 * including Latin Extended, Greek and Cyrillic, unlike the standard PDF fonts
 * which only support WinAnsi.
 */
export const loadInterFonts: PdfFontLoader = async () => {
  const [regular, bold] = await Promise.all([fetchFont(interRegularUrl), fetchFont(interBoldUrl)]);
  return { regular, bold };
};

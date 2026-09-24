import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import type { RankingRow } from "../../engine/types";
import type { Currency } from "../../bindings/Currency";
import { i18n as english, type I18n } from "../../i18n";
import { formatPlace, rankingStatus, rankingTitle } from "./labels";
import { moneyFormatter } from "./money";
import { loadInterFonts, type PdfFontLoader } from "./pdfFonts";

export interface RankingPdfOptions {
  tournamentName: string;
  /** Whether the tournament is finished, i.e. whether the ranking is final. */
  finished: boolean;
  winner: number | null;
  /** Timestamp printed in the title of a non-final ranking. Defaults to now. */
  generatedAt?: Date;
  /** Supplies the TrueType fonts. Defaults to the bundled Inter fonts. */
  loadFonts?: PdfFontLoader;
  i18n?: I18n;
  /** With money tracking: a prize column, right-aligned, in this currency. */
  currency?: Currency;
}

const A4: [number, number] = [595, 842];
const MARGIN_LEFT = 40;
const TOP = 800;
const BOTTOM = 40;
const LINE_HEIGHT = 18;
const STATUS_X = 400;
/** With a prize column the status moves left to make room. */
const STATUS_X_WITH_PRIZE = 300;
const PRIZE_RIGHT = 555;

export async function buildRankingPdf(rows: readonly RankingRow[], options: RankingPdfOptions): Promise<Uint8Array> {
  const { tournamentName, finished, winner, generatedAt = new Date(), loadFonts = loadInterFonts, i18n = english, currency } = options;
  const format = currency ? moneyFormatter(i18n.locale, currency) : null;
  const statusX = format ? STATUS_X_WITH_PRIZE : STATUS_X;
  const fonts = await loadFonts();

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  // Embed the whole fonts: @pdf-lib/fontkit's subsetting drops most glyph outlines of
  // Inter 4 (the text extracts correctly but renders blank in Poppler and macOS Preview).
  const font = await pdfDoc.embedFont(fonts.regular);
  const titleFont = await pdfDoc.embedFont(fonts.bold);

  const title = rankingTitle(i18n, finished, generatedAt);
  pdfDoc.setTitle(`${title} - ${tournamentName}`);

  let page = pdfDoc.addPage(A4);
  let y = TOP;
  page.drawText(title, { x: MARGIN_LEFT, y, size: 20, font: titleFont, color: rgb(0, 0, 0) });
  y -= 26;
  page.drawText(tournamentName, { x: MARGIN_LEFT, y, size: 12, font, color: rgb(0.2, 0.2, 0.2) });
  y -= 20;

  for (const row of rows) {
    if (y < BOTTOM) {
      page = pdfDoc.addPage(A4);
      y = TOP;
    }
    page.drawText(`${formatPlace(row)}  ${row.name}`, { x: MARGIN_LEFT, y, size: 12, font, color: rgb(0, 0, 0) });
    page.drawText(rankingStatus(i18n, row, winner), { x: statusX, y, size: format ? 10 : 12, font, color: rgb(0.4, 0.4, 0.4) });
    if (format && row.prize !== undefined) {
      const prize = format(row.prize);
      page.drawText(prize, { x: PRIZE_RIGHT - font.widthOfTextAtSize(prize, 12), y, size: 12, font, color: rgb(0, 0, 0) });
    }
    y -= LINE_HEIGHT;
  }

  return pdfDoc.save();
}

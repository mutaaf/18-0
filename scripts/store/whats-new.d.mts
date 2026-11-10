// Types for whats-new.mjs, so the app's tests can import it under `strict`.
export interface WhatsNewSourceEntry {
  version: string;
  headline: string;
  notes: string[];
}
export declare const WHATS_NEW: string;
export declare function whatsNewFor(
  version: string,
  source?: { versions: WhatsNewSourceEntry[] },
): WhatsNewSourceEntry | null;
export declare function storeText(entry: { headline: string; notes: readonly string[] }): string;

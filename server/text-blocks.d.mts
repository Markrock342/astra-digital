// Types for server/text-blocks.mjs (imported by the React app).
export type TextBlock = { type: "p"; text: string } | { type: "ul"; items: string[] };
export function normalizeText(value: unknown): string;
export function parseBlocks(text: string | null | undefined): TextBlock[];
export function blocksToText(blocks: TextBlock[]): string;

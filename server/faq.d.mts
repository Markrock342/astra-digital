// Types for server/faq.mjs (imported by the React app).
import type { TextBlock } from "./text-blocks.mjs";
export type FaqScope = "all" | "preorder" | "products";
export interface FaqStoredItem {
  id: string;
  question: string;
  answer: string;
  scope: FaqScope;
  productIds?: string[];
  hidden?: boolean;
}
export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  scope: FaqScope;
  productIds: string[];
  hidden: boolean;
}
export interface FaqSettings {
  items: FaqStoredItem[];
}
export const FAQ_SCOPES: FaqScope[];
export const FAQ_SCOPE_LABELS: Record<FaqScope, string>;
export const MAX_FAQ_ITEMS: number;
export const MAX_FAQ_QUESTION: number;
export const MAX_FAQ_ANSWER: number;
export const MAX_FAQ_PRODUCTS: number;
export const MAX_FAQ_CHARS: number;
export const DEFAULT_FAQ: FaqStoredItem[];
export const DEFAULT_FAQ_EN: Record<string, { question: string; answer: string }>;
export function parseBlocks(text: string | null | undefined): TextBlock[];
export function normalizeFaq(
  input: unknown,
  fail: (status: number, message: string) => never,
  options?: { productExists?: (id: string) => boolean },
): FaqSettings;
export function faqItems(faq: FaqSettings | null | undefined): FaqItem[];
export function isDefaultText(item: { id: string; question: string; answer: string }): boolean;
export function localizeFaqItem<T extends { id: string; question: string; answer: string }>(
  item: T,
  lang?: string,
): T;
export function faqForProduct(
  faq: FaqSettings | null | undefined,
  product: { id: string; preorder?: number | boolean | null } | null | undefined,
): FaqItem[];
export function faqForPage(faq: FaqSettings | null | undefined): { general: FaqItem[]; preorder: FaqItem[] };
export function searchFaq<T extends { question: string; answer: string }>(items: T[], query: string): T[];
export function faqJsonLd(items: { question: string; answer: string }[]): Record<string, unknown>;
export function jsonLdText(data: unknown): string;

// Types for server/legal.mjs (imported by the React app).
export type LegalKind = "terms" | "privacy";
export interface LegalSectionText {
  id: string;
  title: string;
  body: string;
}
export interface LegalSection extends LegalSectionText {
  custom: boolean;
}
export interface StoredSection {
  id: string;
  title?: string;
  body?: string;
}
export interface LegalField {
  key: string;
  label: string;
  max: number;
  fallback?: string;
  optional?: boolean;
  multiline?: boolean;
}
export interface LegalSettings {
  [key: string]: string | StoredSection[] | undefined;
  terms?: StoredSection[];
  privacy?: StoredSection[];
}
export type LegalBlock =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] };
export interface RenderedSection {
  id: string;
  number: number;
  title: string;
  blocks: LegalBlock[];
}
export interface RenderedLegal {
  kind: LegalKind;
  title: string;
  effectiveDate: string;
  sections: RenderedSection[];
  missing: { key: string; label: string }[];
}
export interface LegalShop {
  shopName?: string;
  email?: string;
  phone?: string;
  line?: string;
  policy?: string;
}
export const DEFAULT_FIELD_VALUES: Record<string, string>;
export const DEFAULT_TERMS: LegalSectionText[];
export const DEFAULT_PRIVACY: LegalSectionText[];
export const LEGAL_DOCS: Record<
  LegalKind,
  { title: string; path: string; defaults: LegalSectionText[] }
>;
export const LEGAL_KINDS: LegalKind[];
export const LEGAL_FIELDS: LegalField[];
export const EXTRA_PLACEHOLDERS: { key: string; label: string }[];
export const MAX_SECTIONS: number;
export const MAX_SECTION_TITLE: number;
export const MAX_SECTION_BODY: number;
export const MAX_LEGAL_CHARS: number;
export const POLICY_SECTION_ID: string;
export function normalizeLegal(
  input: unknown,
  fail: (status: number, message: string) => never,
): LegalSettings;
export function fieldValue(legal: LegalSettings | null | undefined, key: string): string;
export function legalValues(
  legal: LegalSettings | null | undefined,
  shop?: LegalShop | null,
  options?: { website?: string },
): { values: Record<string, string>; missing: LegalField[] };
export function legalSections(
  kind: LegalKind,
  legal: LegalSettings | null | undefined,
  policy?: string,
): LegalSection[];
export function storedSections(
  kind: LegalKind,
  sections: LegalSectionText[],
): StoredSection[];
export function fillTemplate(text: string, values: Record<string, string>): string;
export function parseBlocks(text: string): LegalBlock[];
export function formatThaiDate(iso: string): string;
export function renderLegalDocument(
  kind: LegalKind,
  legal: LegalSettings | null | undefined,
  shop?: LegalShop | null,
  options?: { website?: string; sections?: LegalSectionText[] },
): RenderedLegal;

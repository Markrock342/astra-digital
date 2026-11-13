// Types for server/appearance-rules.mjs (imported by the React app).
export type TextPair = { th: string; en: string };
export type HomeSectionId =
  | "banners"
  | "hero"
  | "marquee"
  | "stats"
  | "activity"
  | "announcement"
  | "categories"
  | "products";
export type Accent = "blue" | "yellow" | "duo" | "mono";
export type AppearanceButton = { label: TextPair; link: string };
export type TrustCard = { icon: string; title: TextPair; text: TextPair };
export type FooterLink = { label: TextPair; link: string };
export interface Appearance {
  hero: { headline: TextPair; subtext: TextPair; primary: AppearanceButton; secondary: AppearanceButton };
  marquee: TextPair[];
  sections: { id: HomeSectionId; visible: boolean }[];
  colors: { primary: string | null; secondary: string | null; defaultAccent: Accent };
  trust: { show: boolean; heading: TextPair; text: TextPair; cards: TrustCard[] };
  footer: { description: TextPair; links: FooterLink[] };
  seo: { title: TextPair; description: TextPair; ogImageUrl?: string | null; faviconUrl?: string | null };
}
export type AppearancePart = keyof Appearance;
export const APPEARANCE_PARTS: AppearancePart[];
export const HOME_SECTIONS: HomeSectionId[];
export const ALWAYS_VISIBLE_SECTIONS: HomeSectionId[];
export const SECTION_LABELS: Record<HomeSectionId, string>;
export const TRUST_ICONS: string[];
export const ACCENTS: Accent[];
export const LIMITS: {
  heroHeadline: number;
  heroSubtext: number;
  buttonLabel: number;
  marqueeItem: number;
  marqueeMax: number;
  trustHeading: number;
  trustText: number;
  cardTitle: number;
  cardText: number;
  cardsMax: number;
  footerDescription: number;
  linkLabel: number;
  footerLinksMax: number;
  seoTitle: number;
  seoDescription: number;
  link: number;
};
export const DEFAULT_APPEARANCE: Readonly<Appearance>;
export function defaultAppearance(): Appearance;
export const HEX_COLOR: RegExp;
export const LIGHT_BG: string;
export const DARK_BG: string;
export function luminance(hex: string): number;
export function contrast(a: string, b: string): number;
export function mix(a: string, b: string, amount: number): string;
export function inkOn(fill: string): string;
export const MIN_FILL_CONTRAST: number;
export const SOFT_FILL_CONTRAST: number;
export const TEXT_CONTRAST: number;
export type ColorTokens = {
  light: { fill: string; fill2: string; ink: string; text: string };
  dark: { fill: string; ink: string; text: string };
};
export function colorTokens(hex: string): ColorTokens;
export function checkColor(hex: string | null | undefined, label?: string): { problem: string; warnings: string[] };
type Fail = (status: number, message: string) => never;
export const NORMALIZERS: { [K in AppearancePart]: (input: unknown, fail: Fail) => Appearance[K] };
export function normalizeAppearanceParts(input: unknown, fail: Fail): Partial<Appearance>;
export function resolveAppearance(stored: unknown): Appearance;
export function pick(value: TextPair | null | undefined, lang: string): string;

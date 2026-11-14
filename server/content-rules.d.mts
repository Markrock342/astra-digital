// Types for server/content-rules.mjs (imported by the React app).
import type { TextPair } from "./appearance-rules.mjs";
export type Inline = { type: "text"; text: string } | { type: "link"; text: string; href: string };
export type RichBlock = { kind: "p" | "ul" | "ol"; lines: Inline[][] };
export type EventState = "upcoming" | "ongoing" | "ended";
export type AboutHighlight = { icon: string; title: TextPair; text: TextPair };
export type AboutContent = {
  heading: TextPair;
  body: TextPair;
  highlights: AboutHighlight[];
  showContact: boolean;
  coverUrl?: string | null;
};
export const NEWS_LIMITS: {
  title: number;
  summary: number;
  body: number;
  linkLabel: number;
  link: number;
  maxPosts: number;
  publicList: number;
};
export const ABOUT_LIMITS: {
  heading: number;
  body: number;
  highlightTitle: number;
  highlightText: number;
  highlights: number;
};
export const ABOUT_ICONS: string[];
export function bangkokDate(ms: number): string;
export function isSafeHref(value: unknown): boolean;
export function parseInline(line: string): Inline[];
export function parseRichText(text: string | null | undefined): RichBlock[];
export function richTextPlain(text: string | null | undefined): string;
export function eventState(starts: string | null, ends: string | null, today: string): EventState | null;
export function pickText(th: string | null | undefined, en: string | null | undefined, lang: string): string;
export function defaultAbout(shopName: string | null | undefined): AboutContent;

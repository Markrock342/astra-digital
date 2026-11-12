// Built-in product image library: static covers in public/library (scripts/build-image-library.mjs).
// Pure helpers only (no React), so the matcher is unit-tested in tests/image-library.test.mjs.

export type LibraryCategory = "streaming" | "music" | "ai" | "productivity" | "storage" | "vpn" | "games";

export type LibraryItem = {
  slug: string;
  name: string;
  category: LibraryCategory;
  keywords: string[];
  file: string;
  source: string;
  license: string;
};

export const LIBRARY_CATEGORIES: { id: LibraryCategory | "all"; label: string }[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "streaming", label: "ดูหนัง/ซีรีส์" },
  { id: "music", label: "เพลง" },
  { id: "ai", label: "AI" },
  { id: "productivity", label: "ทำงาน/เรียน" },
  { id: "storage", label: "คลาวด์" },
  { id: "vpn", label: "VPN" },
  { id: "games", label: "เกม" },
];

/** Lower-case, drop spaces and punctuation (Thai letters and combining marks are kept). */
export function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}+]/gu, "");
}

let cached: Promise<LibraryItem[]> | null = null;

/** Fetch /library/manifest.json once per page load. */
export function loadLibrary(): Promise<LibraryItem[]> {
  cached ??= fetch("/library/manifest.json", { credentials: "same-origin" })
    .then((r) => {
      if (!r.ok) throw new Error("โหลดคลังรูปไม่สำเร็จ");
      return r.json() as Promise<{ items: LibraryItem[] }>;
    })
    .then((m) => m.items)
    .catch((e: Error) => {
      cached = null; // let the next open retry
      throw e;
    });
  return cached;
}

/** Search box: every typed word must hit the name or a keyword (Thai or English). */
export function searchLibrary(items: LibraryItem[], query: string, category: LibraryCategory | "all" = "all") {
  const words = query.split(/\s+/).map(normalize).filter(Boolean);
  return items.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (!words.length) return true;
    const hay = [item.name, item.slug, ...item.keywords].map(normalize);
    return words.every((w) => hay.some((h) => h.includes(w)));
  });
}

/**
 * Best cover for a product name, or null. A keyword must appear inside the name; the longest
 * keyword wins, so "YouTube Music 1 เดือน" picks YouTube Music over YouTube Premium.
 * Keywords shorter than 3 characters never auto-match (too easy to hit by accident).
 */
export function suggestFromName(items: LibraryItem[], name: string): LibraryItem | null {
  const text = normalize(name);
  if (text.length < 3) return null;
  let best: LibraryItem | null = null;
  let bestLength = 0;
  for (const item of items)
    for (const keyword of [item.name, ...item.keywords]) {
      const k = normalize(keyword);
      if (k.length >= 3 && k.length > bestLength && text.includes(k)) {
        best = item;
        bestLength = k.length;
      }
    }
  return best;
}

/** Fetch a library cover as an image/webp Blob ready for uploadImage(). */
export async function libraryBlob(item: LibraryItem): Promise<Blob> {
  const response = await fetch(item.file, { credentials: "same-origin" });
  if (!response.ok) throw new Error("โหลดรูปจากคลังไม่สำเร็จ");
  // Some static servers send webp as application/octet-stream; the upload API needs the real type.
  return new Blob([await response.arrayBuffer()], { type: "image/webp" });
}

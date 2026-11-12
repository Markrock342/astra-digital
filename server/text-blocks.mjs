// Plain text → display blocks, shared by the legal pages and the FAQ. No HTML is ever
// produced: the UI renders each block as React text nodes, so typed markup stays literal.

const BULLET = /^\s*[-•*]\s+/;

/** CRLF → LF and control characters removed (tabs and newlines stay). */
export const normalizeText = (value) =>
  String(value).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");

/** Plain text → blocks: blank line = new paragraph, "- " / "• " / "* " = bullet. */
export function parseBlocks(text) {
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "p", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (const line of normalizeText(text ?? "").split("\n")) {
    if (!line.trim()) {
      flush();
      list = null;
      continue;
    }
    if (BULLET.test(line)) {
      flush();
      const item = line.replace(BULLET, "").trim();
      if (!item) continue;
      if (!list) {
        list = { type: "ul", items: [] };
        blocks.push(list);
      }
      list.items.push(item);
      continue;
    }
    list = null;
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** Blocks → one plain string (paragraphs separated by a blank line, bullets as "- "). */
export function blocksToText(blocks) {
  return blocks
    .map((b) => (b.type === "ul" ? b.items.map((i) => "- " + i).join("\n") : b.text))
    .join("\n\n");
}

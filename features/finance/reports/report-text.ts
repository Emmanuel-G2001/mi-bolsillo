const winAnsi = new Set([..."ƒ–—‘’‚“”„†‡•…€‰‹›ˆ™Œœ˜ŠšŸŽž"]);

function visibleCodePoint(character: string) {
  return `[U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`;
}

export function pdfReportText(value: string) {
  return [...value.normalize("NFC")].map((character) => {
    const code = character.codePointAt(0)!;
    const latin = (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff && code !== 0xad);
    return character === "\n" || latin || winAnsi.has(character) ? character : visibleCodePoint(character);
  }).join("");
}

export function xlsxReportText(value: string) {
  // Escape each initiating underscore, including one shared by two escape-shaped sequences.
  return value.replace(/_(?=x[0-9a-f]{4}_)/gi, "_x005F_")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\uD800-\uDFFF\uFFFE\uFFFF]/gu, visibleCodePoint);
}

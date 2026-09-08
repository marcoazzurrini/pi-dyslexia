import { lexer, type Token, type Tokens } from "marked";
import { decodeHTML } from "entities";

/** Render speech without changing the stored answer or asking an LLM to rewrite it. */
export function speechChunks(markdown: string, includeAll = false): string[] {
  function render(tokens: Token[]): string {
    return tokens.map((token): string => {
      switch (token.type) {
        case "space": case "hr": case "br": return "\n";
        case "code": return includeAll ? `\nCode block. ${token.text}\nEnd code block.\n` : "\nCode block skipped.\n";
        case "codespan": case "escape": return token.text;
        case "link": {
          const label = token.tokens ? render(token.tokens) : decodeHTML(token.text);
          if (label === token.href) return includeAll ? label : "URL skipped.";
          return `${label} (${includeAll ? token.href : "link destination skipped"})`;
        }
        case "blockquote": return `\nQuote. ${token.tokens ? render(token.tokens) : token.text}\nEnd quote.\n`;
        case "image": return `Image: ${token.text || "no description"}. Image contents not narrated.`;
        case "html": return ` HTML markup: ${token.text} `;
        case "del": return ` Deleted text: ${token.tokens ? render(token.tokens) : decodeHTML(token.text)}. End deleted text. `;
        case "list": return "\n" + token.items.map((item: Tokens.ListItem, i: number) =>
          `${token.ordered ? `${Number(token.start) + i}. ` : ""}${item.task ? (item.checked ? "Checked. " : "Unchecked. ") : ""}${render(item.tokens)}`,
        ).join("\n") + "\n";
        case "table": return "\nTable.\n" + [token.header, ...token.rows]
          .map((row) => row.map((cell: Tokens.TableCell) => render(cell.tokens)).join("; ")).join("\n") + "\nEnd table.\n";
        default: {
          const value = "tokens" in token && token.tokens ? render(token.tokens as Token[]) : "text" in token ? decodeHTML(String(token.text)) : token.raw;
          return ["heading", "paragraph", "blockquote"].includes(token.type) ? `\n${value}\n` : value;
        }
      }
    }).join("");
  }
  const text = render(lexer(markdown)).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return text.split(/\n+/).flatMap((line) => {
    const sentences: string[] = [];
    for (const { segment } of segmenter.segment(line)) {
      // ICU can split inside a URL at '?'. Do not break a non-whitespace token.
      if (sentences.length && !/\s$/.test(sentences.at(-1)!) && !/^\s/.test(segment)) sentences[sentences.length - 1] += segment;
      else sentences.push(segment);
    }
    return sentences.flatMap((segment) => {
    // ponytail: cap long sentences at 500 code points; use alignment if natural pause placement becomes important.
    const chunks: string[] = [];
    let pending = "";
    for (const word of segment.match(/\S+\s*/gu) ?? []) {
      if ([...pending, ...word].length > 500 && pending.trim()) {
        chunks.push(pending.trim());
        pending = "";
      }
      const pieces = word.match(/[\s\S]{1,500}/gu) ?? [];
      chunks.push(...pieces.slice(0, -1));
      pending += pieces.at(-1) ?? "";
    }
    if (pending.trim()) chunks.push(pending.trim());
    return chunks;
    });
  });
}

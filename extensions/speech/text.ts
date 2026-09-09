import { decodeHTML } from "entities";
import type { Token, Tokens } from "marked";
import { lexer } from "marked";

type RenderTokens = (tokens: Token[]) => string;

const renderLink = (
  href: string,
  label: string,
  includeAll: boolean
): string => {
  if (label === href) {
    return includeAll ? label : "URL skipped.";
  }
  return `${label} (${includeAll ? href : "link destination skipped"})`;
};

const renderList = (
  listItems: Tokens.ListItem[],
  start: number | undefined,
  render: RenderTokens
): string => {
  const items = listItems.map((item, index) => {
    const position = start === undefined ? "" : `${start + index}. `;
    let checkbox = "";
    if (item.task) {
      checkbox = item.checked ? "Checked. " : "Unchecked. ";
    }
    return `${position}${checkbox}${render(item.tokens)}`;
  });
  return `\n${items.join("\n")}\n`;
};

const renderFallback = (token: Token, render: RenderTokens): string => {
  let value = token.raw;
  if ("tokens" in token && Array.isArray(token.tokens)) {
    value = render(token.tokens);
  } else if ("text" in token) {
    value = decodeHTML(String(token.text));
  }
  return ["heading", "paragraph", "blockquote"].includes(token.type)
    ? `\n${value}\n`
    : value;
};

const renderToken = (
  token: Token,
  render: RenderTokens,
  includeAll: boolean
): string => {
  switch (token.type) {
    case "space":
    case "hr":
    case "br": {
      return "\n";
    }
    case "code": {
      return includeAll
        ? `\nCode block. ${token.text}\nEnd code block.\n`
        : "\nCode block skipped.\n";
    }
    case "codespan":
    case "escape": {
      return token.text;
    }
    case "link": {
      const label = token.tokens
        ? render(token.tokens)
        : decodeHTML(token.text);
      return renderLink(token.href, label, includeAll);
    }
    case "blockquote": {
      return `\nQuote. ${token.tokens ? render(token.tokens) : token.text}\nEnd quote.\n`;
    }
    case "image": {
      return `Image: ${token.text || "no description"}. Image contents not narrated.`;
    }
    case "html": {
      return ` HTML markup: ${token.text} `;
    }
    case "del": {
      return ` Deleted text: ${token.tokens ? render(token.tokens) : decodeHTML(token.text)}. End deleted text. `;
    }
    case "list": {
      return renderList(
        token.items,
        token.ordered ? Number(token.start) : undefined,
        render
      );
    }
    case "table": {
      const rows = [token.header, ...token.rows].map((row) =>
        row.map((cell: Tokens.TableCell) => render(cell.tokens)).join("; ")
      );
      return `\nTable.\n${rows.join("\n")}\nEnd table.\n`;
    }
    default: {
      return renderFallback(token, render);
    }
  }
};

const isSpokenCharacter = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return (
    code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
  );
};

const splitLongSentence = (segment: string): string[] => {
  // Cap long sentences at 500 code points without splitting surrogate pairs.
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
  if (pending.trim()) {
    chunks.push(pending.trim());
  }
  return chunks;
};

/** Render speech without changing the stored answer or asking an LLM to rewrite it. */
export const speechChunks = (
  markdown: string,
  includeAll = false
): string[] => {
  const render: RenderTokens = (tokens) =>
    tokens.map((token) => renderToken(token, render, includeAll)).join("");
  const text = [...render(lexer(markdown))].filter(isSpokenCharacter).join("");
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return text.split(/\n+/u).flatMap((line) => {
    const sentences: string[] = [];
    for (const { segment } of segmenter.segment(line)) {
      // ICU can split inside a URL at '?'. Do not break a non-whitespace token.
      const previous = sentences.at(-1);
      if (
        previous !== undefined &&
        !/\s$/u.test(previous) &&
        !/^\s/u.test(segment)
      ) {
        sentences[sentences.length - 1] += segment;
      } else {
        sentences.push(segment);
      }
    }
    return sentences.flatMap(splitLongSentence);
  });
};

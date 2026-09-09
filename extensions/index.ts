import { readFile } from "node:fs/promises";

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export default async function dyslexia(pi: ExtensionAPI): Promise<void> {
  const skill = await readFile(new URL("SKILL.md", import.meta.url), "utf-8");
  const body = skill
    .match(/^---\r?\n[\s\S]*?\r?\n---\r?\n(?<body>[\s\S]*)$/u)
    ?.groups?.body.trim();
  if (!body) {
    throw new Error(
      "Invalid SKILL.md: expected frontmatter and a non-empty body."
    );
  }

  const activePrompt = `${body}

## pi-dyslexia state
pi-dyslexia is ON. Apply the writing policy above.
The extension controls activation through /dyslexia on|off|status. Do not claim to change this setting through conversation.`;
  const inactivePrompt =
    "pi-dyslexia is OFF. Use normal, clear prose instead of this extension's writing policy or earlier versions of it. Respect explicit requests for brevity.";
  let enabled = true;

  const showStatus = (ctx: ExtensionContext): void => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("dyslexia", `dyslexia: ${enabled ? "on" : "off"}`);
    }
  };

  pi.on("session_start", (_event, ctx) => {
    enabled = true;
    showStatus(ctx);
  });

  pi.registerCommand("dyslexia", {
    description: "Writing policy: on|off|status (starts on every session load)",
    handler: (args, ctx) => {
      const command = args.trim().toLowerCase();
      switch (command) {
        case "on": {
          enabled = true;
          break;
        }
        case "off": {
          enabled = false;
          break;
        }
        case "":
        case "status": {
          break;
        }
        default: {
          if (ctx.hasUI) {
            ctx.ui.notify("Usage: /dyslexia on|off|status", "error");
          }
          return Promise.resolve();
        }
      }
      showStatus(ctx);
      if (ctx.hasUI) {
        ctx.ui.notify(`pi-dyslexia ${enabled ? "on" : "off"}.`, "info");
      }
      return Promise.resolve();
    },
  });

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${enabled ? activePrompt : inactivePrompt}`,
  }));
}

import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default async function dyslexia(pi: ExtensionAPI): Promise<void> {
  const skill = await readFile(new URL("./SKILL.md", import.meta.url), "utf8");
  const body = skill.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/)?.[1].trim();
  if (!body) throw new Error("Invalid SKILL.md: expected frontmatter and a non-empty body.");

  const activePrompt = `${body}

## pi-dyslexia state
Caveman is ON. Use the adapted writing policy above instead of earlier Caveman intensity instructions.
The extension controls activation through /dyslexia caveman on|off|status. Do not claim to change this setting through conversation.`;
  const inactivePrompt = "Caveman is OFF. Use normal, clear prose instead of earlier Caveman style instructions. Respect explicit requests for brevity.";
  let enabled = true;

  function showStatus(ctx: ExtensionContext): void {
    if (ctx.hasUI) ctx.ui.setStatus("dyslexia", `caveman: ${enabled ? "on" : "off"}`);
  }

  pi.on("session_start", (_event, ctx) => {
    enabled = true;
    showStatus(ctx);
  });

  pi.registerCommand("dyslexia", {
    description: "Adapted Caveman: caveman on|off|status (starts on every session load)",
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase().replace(/\s+/g, " ");
      switch (command) {
        case "caveman on":
          enabled = true;
          break;
        case "caveman off":
          enabled = false;
          break;
        case "":
        case "caveman":
        case "caveman status":
          break;
        default:
          if (ctx.hasUI) ctx.ui.notify("Usage: /dyslexia caveman on|off|status", "error");
          return;
      }
      showStatus(ctx);
      if (ctx.hasUI) ctx.ui.notify(`Caveman ${enabled ? "on" : "off"}.`, "info");
    },
  });

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${enabled ? activePrompt : inactivePrompt}`,
  }));
}

import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default async function dyslexia(pi: ExtensionAPI): Promise<void> {
  const skill = await readFile(new URL("./vendor/caveman/SKILL.md", import.meta.url), "utf8");
  const body = skill.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/)?.[1].trim();
  if (!body) throw new Error("Invalid bundled Caveman skill: expected frontmatter and a non-empty body.");

  const activePrompt = `${body}

## pi-dyslexia settings (override upstream defaults)
Caveman is ON. Selected intensity: ultra, not the upstream default full.
Only the ultra intensity applies; other levels are reference examples.
The extension controls activation through /dyslexia caveman on|off|status, not the upstream /caveman commands. Do not claim to change this setting through conversation.
Preserve meaningful uncertainty, limitations, and safety warnings. Remove filler, not facts. Keep code, commands, paths, numbers, units, negations, and exact errors intact.`;
  const inactivePrompt = "Caveman is OFF. Use normal, clear prose instead of earlier Caveman style instructions. Respect explicit requests for brevity.";
  let enabled = true;

  function showStatus(ctx: ExtensionContext): void {
    if (ctx.hasUI) ctx.ui.setStatus("dyslexia", `caveman: ${enabled ? "ultra" : "off"}`);
  }

  pi.on("session_start", (_event, ctx) => {
    enabled = true;
    showStatus(ctx);
  });

  pi.registerCommand("dyslexia", {
    description: "Caveman ultra: caveman on|off|status (starts on every session load)",
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
      if (ctx.hasUI) ctx.ui.notify(`Caveman ${enabled ? "on (ultra)" : "off"}.`, "info");
    },
  });

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${enabled ? activePrompt : inactivePrompt}`,
  }));
}

import assert from "node:assert/strict";
import {
  setImmediate as tick,
  setTimeout as delay,
} from "node:timers/promises";

import type {
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionEvent,
  ExtensionHandler,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

class Registry<K, V> extends Map<K, V> {
  override get(key: K): V {
    const value = super.get(key);
    assert.ok(value !== undefined, `missing registration: ${String(key)}`);
    return value;
  }
}

export const last = <T>(values: readonly T[]): T => {
  const value = values.at(-1);
  assert.ok(value !== undefined, "expected a recorded value");
  return value;
};

export const noop = () => {
  // Use when a test deliberately does not observe a notification or control.
};

export const restoreEnvironment = (
  environment: Record<string, string | undefined>
) => {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }
};

export const until = async <T>(
  check: () => T | Promise<T>,
  remaining = 40,
  interval = 0
): Promise<T> => {
  const result = await check();
  if (result) {
    return result;
  }
  assert.ok(remaining > 0, "expected async state");
  await (interval === 0 ? tick() : delay(interval));
  return until(check, remaining - 1, interval);
};

// Only supplied members exist. Unexpected host API use fails instead of silently
// succeeding. Partial<T> checks each supplied member against the real Pi API.
const stub = <T extends object>(members: Partial<T>): T =>
  // SAFETY: Partial<T> checks supplied members; the proxy rejects missing members at runtime.
  new Proxy(members, {
    get(target, key) {
      assert.ok(key in target, `unexpected mock access: ${String(key)}`);
      // SAFETY: The presence check above restricts access to supplied mock members.
      return target[key as keyof T];
    },
  }) as T;

type EventName = ExtensionEvent["type"];
type EventFor<K extends EventName> = Extract<ExtensionEvent, { type: K }>;
type EventResult<K extends EventName> = K extends "before_agent_start"
  ? BeforeAgentStartEventResult
  : unknown;

type RegisteredHandler = ExtensionHandler<never, unknown>;

const createHandlers = () => {
  const registrations = new Registry<EventName, RegisteredHandler>();
  return {
    get<K extends EventName>(name: K) {
      // SAFETY: Pi's overloaded on() contract associates each event with its handler.
      // Registration and retrieval use the same event name.
      const handler = registrations.get(name) as ExtensionHandler<
        EventFor<K>,
        EventResult<K>
      >;
      return (
        data: Partial<Omit<EventFor<K>, "type">>,
        context: ExtensionContext
      ) => {
        // SAFETY: data is checked against EventFor<K> and name supplies its matching
        // discriminant. The proxy rejects reads of omitted event fields.
        const event = stub<EventFor<K>>({ ...data, type: name } as Partial<
          EventFor<K>
        >);
        return handler(event, context);
      };
    },
    keys() {
      return registrations.keys();
    },
    set(name: EventName, handler: RegisteredHandler): void {
      registrations.set(name, handler);
    },
  };
};

export const extensionHarness = () => {
  const handlers = createHandlers();
  const commands = new Registry<
    string,
    Parameters<ExtensionAPI["registerCommand"]>[1]
  >();
  const shortcuts = new Registry<
    Parameters<ExtensionAPI["registerShortcut"]>[0],
    Parameters<ExtensionAPI["registerShortcut"]>[1]
  >();
  const api = stub<ExtensionAPI>({
    on: (name, handler) => {
      handlers.set(name, handler);
    },
    registerCommand: (name, command) => {
      commands.set(name, command);
    },
    registerShortcut: (key, shortcut) => {
      shortcuts.set(key, shortcut);
    },
  });
  return { api, commands, handlers, shortcuts };
};

type ContextMembers = Partial<
  Omit<ExtensionCommandContext, "ui" | "sessionManager">
> & {
  sessionManager?: Partial<ExtensionContext["sessionManager"]>;
  ui?: Partial<ExtensionContext["ui"]>;
};

export const testContext = (members: ContextMembers): ExtensionCommandContext =>
  stub<ExtensionCommandContext>({
    ...members,
    sessionManager: stub<ExtensionContext["sessionManager"]>(
      members.sessionManager ?? {}
    ),
    ui: stub<ExtensionContext["ui"]>(members.ui ?? {}),
  });

export type Notices = Parameters<ExtensionContext["ui"]["notify"]>[];
export type Statuses = Parameters<ExtensionContext["ui"]["setStatus"]>[];
type WidgetArguments = Parameters<ExtensionContext["ui"]["setWidget"]>;
export type Widgets = [
  key: string,
  content: WidgetArguments[1] | string[],
  options?: WidgetArguments[2],
][];

export const widget = (widgets: Widgets) => {
  const [, factory] = last(widgets);
  assert.ok(factory && !Array.isArray(factory), "expected a component widget");
  return factory(
    stub<Parameters<typeof factory>[0]>({}),
    stub<Parameters<typeof factory>[1]>({})
  );
};

type AssistantMessage = Extract<
  SessionMessageEntry["message"],
  { role: "assistant" }
>;
export type AssistantEntry = SessionMessageEntry & {
  message: AssistantMessage;
};

export const assistantEntry = (
  id: string,
  stopReason: AssistantMessage["stopReason"] = "stop",
  text = "A completed answer."
): AssistantEntry => ({
  id,
  message: {
    api: "openai-completions",
    content: [
      { thinking: "secret", type: "thinking" },
      { text, type: "text" },
    ],
    model: "test-model",
    provider: "openai",
    role: "assistant",
    stopReason,
    timestamp: 0,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  },
  parentId: null,
  timestamp: "2026-01-01T00:00:00.000Z",
  type: "message",
});

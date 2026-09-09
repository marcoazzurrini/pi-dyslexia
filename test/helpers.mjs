import assert from "node:assert/strict";
import {
  setImmediate as tick,
  setTimeout as delay,
} from "node:timers/promises";

export { setImmediate as tick } from "node:timers/promises";

export const noop = () => {
  // Use when a test deliberately does not observe a notification or control.
};

export const restoreEnvironment = (environment) => {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }
};

export const until = async (check, remaining = 40, interval = 0) => {
  const result = await check();
  if (result) {
    return result;
  }
  assert.ok(remaining > 0, "expected async state");
  await (interval === 0 ? tick() : delay(interval));
  return until(check, remaining - 1, interval);
};

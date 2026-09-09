// Model-free protocol fixture. Never opens an audio device.
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

const [argument] = process.argv.slice(2);
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
if (argument === "--player") {
  setTimeout(() => send({ event: "ready" }), 40);
}
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  appendFileSync(process.env.SPEECH_TEST_LOG, `${JSON.stringify(request)}\n`);
  if (argument === "--player") {
    // Tests control completion by cancellation; only unpaused playback acknowledges a start.
    if (request.action === "play" && !request.paused) {
      send({ event: "started", id: request.id, output_delay_ms: 0 });
    }
  } else {
    writeFileSync(path.join(argument, `${request.id}.wav`), Buffer.alloc(48));
    send({ id: request.id, seconds: 1 });
  }
}

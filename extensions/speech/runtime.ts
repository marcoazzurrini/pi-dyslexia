import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeHome = path.join(homedir(), ".cache/pi-dyslexia/native/home");
const executable = path.join(
  homedir(),
  ".cache/pi-dyslexia/native/bin/pi-speech"
);

export const setupPath = fileURLToPath(
  new URL("native/setup.sh", import.meta.url)
);
export const setupDescription =
  "This builds the Swift/FluidAudio helper and downloads pinned Kokoro models, five voice packs, and English pronunciation assets. Apple Silicon, Swift 6, and Apple's command-line tools are required.\nInternet access and disk space are required. Setup may take several minutes. No administrator access or shell profile changes.\nAfter setup, narration stays local and network access is blocked. No audio plays during setup.";

/** Block network access even in upstream download paths that ignore offlineMode. */
export const workerCommand = (argument: string) => ({
  args: [
    "-p",
    "(version 1)(allow default)(deny network*)",
    executable,
    argument,
  ],
  executable: "/usr/bin/sandbox-exec",
});

export const workerEnvironment = (): NodeJS.ProcessEnv => {
  const environment = { ...process.env };
  // FluidAudio's pronunciation cache uses Foundation's home directory.
  // Keep it separate from other applications without changing their caches.
  environment.CFFIXED_USER_HOME = runtimeHome;
  environment.PI_DYSLEXIA_NATIVE_HOME = runtimeHome;
  environment.OS_ACTIVITY_MODE = "disable";
  delete environment.CI;
  return environment;
};

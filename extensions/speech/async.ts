/** Observe background work without reporting failures twice to the user. */
export const ignoreRejection = async <T>(task: Promise<T>): Promise<void> => {
  try {
    await task;
  } catch {
    // The foreground operation owns error reporting and recovery.
  }
};

/** Preserve a speculative result, including failure, until playback needs it. */
export const captureGeneration = async (task: Promise<string>) => {
  try {
    return { path: await task };
  } catch (error) {
    return { error };
  }
};

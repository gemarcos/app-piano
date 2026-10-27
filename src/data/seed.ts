// Owner: library. Seeds the public-domain demo pieces (src/data/demos.ts) into the library on first run.

/** Seeds demo pieces once per device (and again after "Restaurar ejemplos"). Safe to call repeatedly. */
export async function seedDemosOnce(): Promise<void> {
  // implemented by the library owner
}

/** Re-adds any missing demo pieces (used by Settings > "Restaurar ejemplos"). Returns how many were added. */
export async function restoreDemos(): Promise<number> {
  return 0
}

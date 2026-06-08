/** Open the native directory picker. Returns the chosen path, or null if cancelled. */
export async function pickDirectory(): Promise<string | null> {
  return (await window.claudedeck?.app.pickDirectory?.()) ?? null
}

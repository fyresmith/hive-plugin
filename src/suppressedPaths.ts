/**
 * Shared set of file paths currently being written programmatically.
 * The WriteInterceptor checks this set at the top of every handler to
 * prevent server-initiated changes from being echoed back to the server.
 */
export const suppressedPaths = new Set<string>();

export function suppress(path: string): void {
  suppressedPaths.add(path);
}

export function unsuppress(path: string): void {
  suppressedPaths.delete(path);
}

export function isSuppressed(path: string): boolean {
  return suppressedPaths.has(path);
}

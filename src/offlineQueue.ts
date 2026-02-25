export type QueuedOp =
  | { type: 'modify' | 'create'; path: string; content: string }
  | { type: 'delete'; path: string }
  | { type: 'rename'; oldPath: string; newPath: string };

export class OfflineQueue {
  private ops: QueuedOp[] = [];

  /**
   * Enqueue an operation.
   * Coalescing rule: if a modify/create already exists for the same path,
   * replace it with the newest content. Deletes and renames are always appended.
   */
  enqueue(op: QueuedOp): void {
    if (op.type === 'modify' || op.type === 'create') {
      const existing = this.ops.findIndex(
        (o) => (o.type === 'modify' || o.type === 'create') && o.path === op.path,
      );
      if (existing !== -1) {
        this.ops[existing] = op;
        return;
      }
    }
    this.ops.push(op);
  }

  getOps(): readonly QueuedOp[] {
    return this.ops;
  }

  getAffectedPaths(): Set<string> {
    const paths = new Set<string>();
    for (const op of this.ops) {
      if (op.type === 'rename') {
        paths.add(op.oldPath);
        paths.add(op.newPath);
      } else {
        paths.add(op.path);
      }
    }
    return paths;
  }

  clear(): void {
    this.ops = [];
  }

  get isEmpty(): boolean {
    return this.ops.length === 0;
  }
}

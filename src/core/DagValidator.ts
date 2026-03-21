import type { LoggerLike } from '@core/Logger.js';

export interface DagNode {
  key: string;
  dependsOn: string[];
}

export interface DagResult {
  valid: boolean;
  cycle?: string[];
}

/**
 * Validate that the dependency graph is a DAG (no cycles).
 * Uses Kahn's algorithm for cycle detection.
 * Dangling refs (deps not in the node set) are ignored.
 */
export function validateDAG(nodes: DagNode[]): DagResult {
  if (nodes.length === 0) return { valid: true };

  // Deduplicate node keys — use first occurrence per key
  const keySet = new Set<string>();
  const deduped: DagNode[] = [];
  for (const node of nodes) {
    if (!keySet.has(node.key)) {
      keySet.add(node.key);
      deduped.push(node);
    }
  }

  // Build in-degree and forward adjacency for Kahn's algorithm.
  // Edge: if B dependsOn A (and A is in set), then A → B (A must come before B).
  // In-degree of B = count of its deps that are within the set.
  const inDeg = new Map<string, number>();
  const fwd = new Map<string, string[]>(); // A → [nodes that depend on A]

  for (const { key } of deduped) {
    inDeg.set(key, 0);
    fwd.set(key, []);
  }

  for (const node of deduped) {
    const uniqueDeps = Array.from(new Set(node.dependsOn));
    for (const dep of uniqueDeps) {
      if (!keySet.has(dep)) continue; // dangling ref — skip
      fwd.get(dep)!.push(node.key);
      inDeg.set(node.key, (inDeg.get(node.key) ?? 0) + 1);
    }
  }

  // Kahn's BFS
  const queue: string[] = [];
  for (const [key, deg] of inDeg) {
    if (deg === 0) queue.push(key);
  }

  let processed = 0;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    processed++;
    for (const dependent of fwd.get(cur) ?? []) {
      const newDeg = (inDeg.get(dependent) ?? 0) - 1;
      inDeg.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  if (processed === keySet.size) {
    return { valid: true };
  }

  // Cycle exists — find one via DFS
  const cycle = findCycle(deduped, keySet);
  return { valid: false, cycle };
}

function findCycle(nodes: DagNode[], keySet: Set<string>): string[] {
  // Build adjacency: node → its deps within set (deduplicated)
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    const deps = Array.from(new Set(node.dependsOn)).filter((d) => keySet.has(d));
    adj.set(node.key, deps);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const key of keySet) color.set(key, WHITE);

  const stack: string[] = [];

  function dfs(node: string): string[] | null {
    color.set(node, GRAY);
    stack.push(node);

    for (const dep of adj.get(node) ?? []) {
      if (color.get(dep) === GRAY) {
        // Found cycle — extract from stack
        const cycleStart = stack.indexOf(dep);
        const cycle = stack.slice(cycleStart);
        cycle.push(dep); // close the cycle (repeat start node)
        return cycle.slice(0, keySet.size + 1);
      }
      if (color.get(dep) === WHITE) {
        const result = dfs(dep);
        if (result !== null) return result;
      }
    }

    stack.pop();
    color.set(node, BLACK);
    return null;
  }

  for (const key of keySet) {
    if (color.get(key) === WHITE) {
      const result = dfs(key);
      if (result !== null) return result;
    }
  }

  return [];
}

/**
 * Log warnings for any dependencies that reference keys not in the node set.
 */
export function checkDanglingRefs(
  nodes: DagNode[],
  log: Pick<LoggerLike, 'warn'>,
): void {
  const keySet = new Set<string>(nodes.map((n) => n.key));
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!keySet.has(dep)) {
        log.warn('load: dangling dependency', { story: node.key, unknownDep: dep });
      }
    }
  }
}

// The shortest chain from the current listing to the nearest confirmed scam in a ring response:
// listing → shared detail → listing → … → confirmed scam. Used to highlight the evidence in the
// graph and to spell it out above it. Pure; safe in client components.
import type { RingNode, RingResponse } from './contracts';

export type EvidencePath = {
  steps: RingNode[];
  nodeIds: Set<string>;
  linkKeys: Set<string>;
};

export const linkKey = (source: string, target: string) => (source < target ? `${source}|${target}` : `${target}|${source}`);

export function evidencePath(data: RingResponse): EvidencePath | null {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const current = data.nodes.find((node) => node.type === 'report' && node.isCurrent);
  if (!current || (current.type === 'report' && current.status === 'confirmed_scam')) return null;
  const neighbours = new Map<string, string[]>();
  for (const link of data.links) {
    neighbours.set(link.source, [...(neighbours.get(link.source) ?? []), link.target]);
    neighbours.set(link.target, [...(neighbours.get(link.target) ?? []), link.source]);
  }
  const previous = new Map<string, string>([[current.id, '']]);
  const queue = [current.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (node?.type === 'report' && node.status === 'confirmed_scam') {
      const ids: string[] = [];
      for (let step = id; step; step = previous.get(step) ?? '') ids.unshift(step);
      const steps = ids.map((stepId) => byId.get(stepId)!).filter(Boolean);
      return {
        steps,
        nodeIds: new Set(ids),
        linkKeys: new Set(ids.slice(1).map((stepId, index) => linkKey(ids[index], stepId))),
      };
    }
    for (const next of neighbours.get(id) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, id);
      queue.push(next);
    }
  }
  return null;
}

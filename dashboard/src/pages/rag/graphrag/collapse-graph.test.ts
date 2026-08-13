// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { collapseGraph, isSuperNodeId, type CollapseNode, type CollapseLink } from './collapse-graph';

const NODES: CollapseNode[] = [
  { id: 'a', name: 'Alice', type: 'person', degree: 3, community_key: '0:1' },
  { id: 'b', name: 'Bob', type: 'person', degree: 2, community_key: '0:1' },
  { id: 'c', name: 'Carol', type: 'person', degree: 1, community_key: '0:2' },
];
const LINKS: CollapseLink[] = [
  { source: 'a', target: 'b', weight: 2 }, // intra 0:1
  { source: 'b', target: 'c', weight: 1 }, // cross 0:1 -> 0:2
];

describe('collapseGraph (M13 community expand/collapse)', () => {
  it('is a no-op when nothing is collapsed', () => {
    const out = collapseGraph(NODES, LINKS, new Set());
    expect(out.nodes).toHaveLength(3);
    expect(out.links).toHaveLength(2);
  });

  it('collapses a community into one aggregate super-node sized by member count', () => {
    const out = collapseGraph(NODES, LINKS, new Set(['0:1']));
    // Carol (0:2) stays; Alice+Bob (0:1) become one super-node
    const superNode = out.nodes.find((n) => n.isGroup);
    expect(superNode).toBeDefined();
    expect(superNode!.id).toBe('grp:0:1');
    expect(superNode!.memberCount).toBe(2);
    expect(superNode!.degree).toBe(5); // 3 + 2
    expect(out.nodes.filter((n) => !n.isGroup).map((n) => n.id)).toEqual(['c']);
  });

  it('drops the intra-community edge and re-routes the cross edge to the super-node', () => {
    const out = collapseGraph(NODES, LINKS, new Set(['0:1']));
    // a-b (both in 0:1) collapses to a self-edge → dropped; b-c re-routes to grp:0:1 - c
    expect(out.links).toHaveLength(1);
    const [l] = out.links;
    const ends = [l.source, l.target].sort();
    expect(ends).toEqual(['c', 'grp:0:1']);
  });

  it('dedupes parallel edges created by collapsing (two members linking to the same outside node)', () => {
    const nodes: CollapseNode[] = [
      { id: 'a', name: 'A', type: 'p', degree: 1, community_key: '0:1' },
      { id: 'b', name: 'B', type: 'p', degree: 1, community_key: '0:1' },
      { id: 'x', name: 'X', type: 'p', degree: 2, community_key: '0:9' },
    ];
    const links: CollapseLink[] = [
      { source: 'a', target: 'x', weight: 1 },
      { source: 'b', target: 'x', weight: 1 },
    ];
    const out = collapseGraph(nodes, links, new Set(['0:1']));
    // both a-x and b-x collapse to grp:0:1 - x → one deduped edge
    expect(out.links).toHaveLength(1);
  });

  it('isSuperNodeId identifies aggregate nodes', () => {
    expect(isSuperNodeId('grp:0:1')).toBe(true);
    expect(isSuperNodeId('a')).toBe(false);
  });
});

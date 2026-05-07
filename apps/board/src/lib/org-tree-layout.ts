import type { RosterEntry } from "./api";

export const NODE_W = 200;
export const NODE_H = 84;
export const H_GAP = 24;
export const V_GAP = 80;

export interface TreeNode {
	entry: RosterEntry;
	children: TreeNode[];
	x: number;
	y: number;
	subtreeWidth: number;
}

export function buildForest(entries: RosterEntry[]): TreeNode[] {
	const byId = new Map<string, TreeNode>();
	for (const entry of entries) {
		byId.set(entry.id, { entry, children: [], x: 0, y: 0, subtreeWidth: 0 });
	}
	const roots: TreeNode[] = [];
	for (const node of byId.values()) {
		const parentId = node.entry.reports_to;
		if (parentId && byId.has(parentId)) {
			byId.get(parentId)!.children.push(node);
		} else {
			roots.push(node);
		}
	}
	return roots;
}

export function computeSubtreeWidth(node: TreeNode): number {
	if (node.children.length === 0) {
		node.subtreeWidth = NODE_W;
		return NODE_W;
	}
	const total = node.children.reduce(
		(sum, child) => sum + computeSubtreeWidth(child),
		0,
	);
	const w = total + H_GAP * (node.children.length - 1);
	node.subtreeWidth = Math.max(NODE_W, w);
	return node.subtreeWidth;
}

export function layoutSubtree(
	node: TreeNode,
	leftX: number,
	topY: number,
): void {
	node.y = topY;
	node.x = leftX + node.subtreeWidth / 2 - NODE_W / 2;
	let cursor = leftX;
	if (node.children.length === 1) {
		cursor = node.x + NODE_W / 2 - node.children[0]!.subtreeWidth / 2;
	}
	for (const child of node.children) {
		layoutSubtree(child, cursor, topY + NODE_H + V_GAP);
		cursor += child.subtreeWidth + H_GAP;
	}
}

export function flatten(roots: TreeNode[]): TreeNode[] {
	const out: TreeNode[] = [];
	const stack = [...roots];
	while (stack.length > 0) {
		const n = stack.pop()!;
		out.push(n);
		stack.push(...n.children);
	}
	return out;
}

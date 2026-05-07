/**
 * setra TUI theme
 *
 * Mirrors the Electron app color palette exactly. Any UI change here must also
 * be reflected in packages/ui/src/theme.ts for the Electron renderer.
 *
 * Terminal rendering note: 256-color and true-color support is detected at
 * runtime. Chalk downgrades gracefully to 16 ANSI colors on limited terminals.
 */

import chalk from "chalk";

// ─── Raw palette (matches CSS variables in the Electron app) ─────────────────

export const palette = {
	// Backgrounds
	bgDeep: "#0d1117", // --color-bg-deep
	bgSurface: "#161b22", // --color-bg-surface
	bgElevated: "#1c2128", // --color-bg-elevated
	bgOverlay: "#22272e", // --color-bg-overlay

	// Borders
	border: "#30363d", // --color-border
	borderSub: "#21262d", // --color-border-sub

	// Text
	textPrimary: "#e6edf3", // --color-text-primary
	textSecondary: "#8b949e", // --color-text-secondary
	textMuted: "#484f58", // --color-text-muted

	// Accent (Neelam blue — setra brand)
	accent: "#4f7eff", // --color-accent
	accentHover: "#6b94ff", // --color-accent-hover
	accentDim: "#1a2a4a", // --color-accent-dim (selected bg)

	// Semantic
	success: "#3fb950", // --color-success
	warning: "#d29922", // --color-warning
	error: "#f85149", // --color-error
	info: "#58a6ff", // --color-info

	// Agent status (runs)
	statusRunning: "#3fb950",
	statusIdle: "#8b949e",
	statusDone: "#3fb950",
	statusError: "#f85149",
	statusPaused: "#d29922",
	statusPending: "#58a6ff",

	// Cost tiers (ledger)
	costLow: "#3fb950", // < $0.10
	costMedium: "#d29922", // $0.10–$1.00
	costHigh: "#f85149", // > $1.00
} as const;

// ─── Chalk helpers ────────────────────────────────────────────────────────────

export const c = {
	// Text
	primary: (s: string) => chalk.hex(palette.textPrimary)(s),
	secondary: (s: string) => chalk.hex(palette.textSecondary)(s),
	muted: (s: string) => chalk.hex(palette.textMuted)(s),
	accent: (s: string) => chalk.hex(palette.accent).bold(s),
	accentDim: (s: string) => chalk.hex(palette.accent)(s),

	// Semantic
	success: (s: string) => chalk.hex(palette.success)(s),
	warning: (s: string) => chalk.hex(palette.warning)(s),
	error: (s: string) => chalk.hex(palette.error)(s),
	info: (s: string) => chalk.hex(palette.info)(s),

	// UI chrome
	border: (s: string) => chalk.hex(palette.border)(s),
	label: (s: string) => chalk.hex(palette.textSecondary).bold(s),
	key: (s: string) => chalk.hex(palette.accent).bold(s),

	// Backgrounds (for selected rows)
	selected: (s: string) =>
		chalk.bgHex(palette.accentDim).hex(palette.textPrimary)(s),
	header: (s: string) => chalk.hex(palette.bgSurface).bgHex(palette.border)(s),
} as const;

// ─── Status indicators (Unicode symbols) ─────────────────────────────────────

export const icon = {
	running: chalk.hex(palette.statusRunning)("●"),
	idle: chalk.hex(palette.statusIdle)("◯"),
	done: chalk.hex(palette.statusDone)("✓"),
	error: chalk.hex(palette.statusError)("✗"),
	paused: chalk.hex(palette.statusPaused)("⏸"),
	pending: chalk.hex(palette.statusPending)("⟳"),
	mark: chalk.hex(palette.accent)("◆"),
	ground: chalk.hex(palette.info)("⬡"),
	trace: chalk.hex(palette.textSecondary)("◎"),
	cost: chalk.hex(palette.warning)("$"),
	arrow: chalk.hex(palette.accent)("›"),
	chevron: chalk.hex(palette.textSecondary)("›"),
	bullet: chalk.hex(palette.textMuted)("·"),
	spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
} as const;

// ─── Box-drawing characters (no ASCII art) ────────────────────────────────────

export const box = {
	// Standard weight
	h: "─",
	v: "│",
	tl: "┌",
	tr: "┐",
	bl: "└",
	br: "┘",
	lm: "├",
	rm: "┤",
	tm: "┬",
	bm: "┴",
	cross: "┼",

	// Heavy (for active/focused borders)
	hH: "━",
	vH: "┃",
	tlH: "┏",
	trH: "┓",
	blH: "┗",
	brH: "┛",
	lmH: "┣",
	rmH: "┫",
	tmH: "┳",
	bmH: "┻",
	crossH: "╋",

	// Double (for modal dialogs)
	hD: "═",
	vD: "║",
	tlD: "╔",
	trD: "╗",
	blD: "╚",
	brD: "╝",

	// Separators
	sep: "│",
	dash: "╌", // lighter horizontal
	ellipsis: "…",
} as const;

// ─── Draw a horizontal rule with optional label ───────────────────────────────

export function hRule(width: number, label?: string, focused = false): string {
	const char = focused ? box.hH : box.h;
	const color = focused ? c.accent : c.border;

	if (!label) return color(char.repeat(width));

	const labelStr = ` ${label} `;
	const sideWidth = Math.max(0, Math.floor((width - labelStr.length) / 2));
	const side = char.repeat(sideWidth);
	return color(side) + c.label(labelStr) + color(side);
}

// ─── Render a bordered box with title ────────────────────────────────────────

export function borderBox(
	content: string[],
	opts: { title?: string; width: number; focused?: boolean },
): string[] {
	const { title, width, focused = false } = opts;
	const cc = focused ? c.accent : c.border;
	const bchar = focused ? box : box; // could differentiate heavy vs normal

	const tl = cc(focused ? box.tlH : box.tl);
	const tr = cc(focused ? box.trH : box.tr);
	const bl = cc(focused ? box.blH : box.bl);
	const br = cc(focused ? box.brH : box.br);
	const h = focused ? box.hH : box.h;
	const v = cc(focused ? box.vH : box.v);

	const innerWidth = width - 2;
	let topLine: string;

	if (title) {
		const t = ` ${title} `;
		const left = Math.max(0, Math.floor((innerWidth - t.length) / 2));
		const right = innerWidth - left - t.length;
		topLine = tl + cc(h.repeat(left)) + c.label(t) + cc(h.repeat(right)) + tr;
	} else {
		topLine = tl + cc(h.repeat(innerWidth)) + tr;
	}

	const bottomLine = bl + cc(h.repeat(innerWidth)) + br;
	const lines = content.map(
		(line) => `${v} ${line.padEnd(innerWidth - 2)} ${v}`,
	);

	return [topLine, ...lines, bottomLine];
}

// ─── Truncate with ellipsis ───────────────────────────────────────────────────

export function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max - 1) + box.ellipsis;
}

// ─── Format cost value with color tier ───────────────────────────────────────

export function formatCost(usd: number): string {
	const str = `$${usd.toFixed(4)}`;
	if (usd < 0.1) return chalk.hex(palette.costLow)(str);
	if (usd < 1.0) return chalk.hex(palette.costMedium)(str);
	return chalk.hex(palette.costHigh)(str);
}

// ─── Format token count with K/M suffix ──────────────────────────────────────

export function formatTokens(n: number): string {
	if (n < 1_000) return c.secondary(`${n}t`);
	if (n < 1_000_000) return c.secondary(`${(n / 1000).toFixed(1)}kt`);
	return c.secondary(`${(n / 1_000_000).toFixed(2)}Mt`);
}

// ─── Relative timestamp ───────────────────────────────────────────────────────

export function relativeTime(date: Date): string {
	const diffMs = Date.now() - date.getTime();
	const diffSec = Math.floor(diffMs / 1000);
	if (diffSec < 60) return c.muted(`${diffSec}s ago`);
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return c.muted(`${diffMin}m ago`);
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return c.muted(`${diffHr}h ago`);
	return c.muted(date.toLocaleDateString());
}

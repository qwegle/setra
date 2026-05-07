/**
 * setra.sh — Company Formation: Electron UI Specification
 *
 * This file defines the React component structure, Zustand store shape,
 * and rendering contract for the Company Mode visual UI.
 *
 * Architecture:
 *   - Main process: CompanyLauncher (spawns agents, runs broker)
 *   - Renderer process: React UI (this file)
 *   - IPC bridge: window.setra.company.* (contextBridge)
 *   - Real-time: SSE → main process → ipcRenderer.send → renderer Zustand store
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────────────┐
 *   │  COMPANY HEADER: name, run status badge, total cost, elapsed time        │
 *   ├─────────────────┬────────────────────────────────┬────────────────────────┤
 *   │  SIDEBAR        │  MESSAGE TIMELINE              │  AGENT TERMINAL        │
 *   │  (agent cards)  │  (main panel)                  │  (bottom panel)        │
 *   │                 │                                │                        │
 *   │  ● architect    │  [#general ▾]  [Search]       │  [architect ▾] [fe ▾]  │
 *   │    Orchestrating│                                │                        │
 *   │    $0.12 / $2   │  ───── Today ─────             │  > Analyzing PR...     │
 *   │                 │  👤 human: Build a search...   │  > Reading 12 files    │
 *   │  ● fe           │                                │  > Writing tests...    │
 *   │    Implementing │  🤖 architect: I'll break...   │                        │
 *   │    $0.04 / $1   │    ↳ @fe @be assigned          │                        │
 *   │                 │                                │                        │
 *   │  ○ be           │  🤖 fe: Claimed task #1...     │                        │
 *   │    Idle         │    ✅ react by @architect      │                        │
 *   │    $0.00 / $1   │                                │  ╔══ APPROVAL QUEUE ══╗│
 *   │                 │  🔔 APPROVAL NEEDED            │  ║ 1 pending           ║│
 *   │  ○ qa           │  ┌─ fe wants to merge ───┐    │  ║ [Review Diff]       ║│
 *   │    Waiting      │  │ Title: Add search UI   │    │  ╚═════════════════════╝│
 *   │    $0.00 / $0.5 │  │ [👁 View Diff] [✅]  [❌] │    │                        │
 *   │                 │  └──────────────────────────┘    │                        │
 *   │  ─────────────  │                                │                        │
 *   │  ACTIVITY GRAPH │  🤖 be: Finished API...        │                        │
 *   │  (token flow)   │                                │                        │
 *   └─────────────────┴────────────────────────────────┴────────────────────────┘
 *
 * Component tree:
 *   <CompanyView>
 *     <CompanyHeader />
 *     <CompanyLayout>
 *       <AgentSidebar />               ← left panel (fixed width ~240px)
 *       <MessageTimeline />            ← center panel (flex grow)
 *       <AgentTerminalPanel />         ← right panel (resizable, collapsible)
 *     </CompanyLayout>
 *     <ApprovalModal />                ← full-screen overlay on approval
 *   </CompanyView>
 */

import type {
	AgentActivitySnapshot,
	AgentStatus,
	ApprovalRequest,
	BrokerSSEEvent,
	Company,
	CompanyChannel,
	CompanyMessage,
	CompanyRun,
	CompanyTask,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// E.1  ZUSTAND STORE SHAPE
// All real-time company state lives here. Updated via SSE events from the broker.
// ─────────────────────────────────────────────────────────────────────────────

export interface CompanyStore {
	// ── Run state ────────────────────────────────────────────────────────────
	run: CompanyRun | null;
	company: Company | null;
	isConnected: boolean;

	// ── Messages ─────────────────────────────────────────────────────────────
	/** All messages indexed by channel slug. */
	messagesByChannel: Map<string, CompanyMessage[]>;
	/** The currently selected channel. */
	activeChannel: string;

	// ── Tasks ─────────────────────────────────────────────────────────────────
	tasks: CompanyTask[];

	// ── Agent activity ────────────────────────────────────────────────────────
	activity: Map<string, AgentActivitySnapshot>;
	/** Raw PTY output lines per agent slug (last 500 lines, ring buffer). */
	agentStreams: Map<string, string[]>;
	/** The agent whose terminal stream is currently shown in the terminal panel. */
	activeStreamAgent: string | null;

	// ── Approvals ─────────────────────────────────────────────────────────────
	pendingApprovals: ApprovalRequest[];
	approvalHistory: ApprovalRequest[];
	/** ID of approval currently being viewed in the diff modal. null = closed. */
	activeDiffApprovalId: string | null;

	// ── Cost tracking ─────────────────────────────────────────────────────────
	/** Total cost for the run so far. */
	totalCostUsd: number;
	/** Per-member cost. member slug → USD. */
	costByMember: Record<string, number>;

	// ── Actions (Zustand actions pattern) ────────────────────────────────────
	actions: {
		/** Called by the SSE subscriber on every broker event. */
		handleBrokerEvent: (event: BrokerSSEEvent) => void;
		setActiveChannel: (channel: string) => void;
		setActiveStreamAgent: (slug: string | null) => void;
		openDiffModal: (approvalId: string) => void;
		closeDiffModal: () => void;
		/** Optimistically add a human message while it's being sent. */
		addHumanMessage: (content: string, channel: string) => void;
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// E.2  COMPANY HEADER COMPONENT PROPS
// ─────────────────────────────────────────────────────────────────────────────

export interface CompanyHeaderProps {
	companyName: string;
	runStatus: CompanyRun["status"];
	totalCostUsd: number;
	budgetUsd: number | null;
	elapsedMs: number;
	/** Called when user clicks "Stop Run" */
	onStop: () => void;
	/** Called when user clicks "Pause Run" */
	onPause: () => void;
}

/**
 * CompanyHeader renders:
 *   - Company name + logo/icon
 *   - Run status badge (color-coded):
 *       starting  → gray spinner
 *       running   → green pulse dot
 *       paused    → yellow pause icon
 *       completed → green checkmark
 *       failed    → red X
 *   - Cost meter: "$1.24 / $5.00" with progress bar
 *     - Bar turns orange at 80%, red at 95%
 *     - Tooltip shows per-member breakdown on hover
 *   - Elapsed time: "12m 34s"
 *   - Stop / Pause buttons
 */

// ─────────────────────────────────────────────────────────────────────────────
// E.3  AGENT SIDEBAR COMPONENT PROPS
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentCardProps {
	member: { slug: string; name: string; role: string; model: string };
	activity: AgentActivitySnapshot;
	costUsd: number;
	budgetUsd: number | null;
	isLead: boolean;
	/** Click: select this agent's terminal stream in the right panel */
	onClick: () => void;
}

/**
 * AgentCard renders (within the sidebar):
 *
 *   ┌──────────────────────────────────┐
 *   │ ● architect        claude-opus   │  ← name + model badge
 *   │   Lead Architect                 │  ← role
 *   │   Orchestrating tasks...         │  ← activity text (live update)
 *   │   ────────────────────────       │
 *   │   $0.34 / $2.00  ▓▓▓▓▓░░░░░     │  ← cost bar
 *   │   12 msgs · 3 tasks claimed      │  ← stats
 *   └──────────────────────────────────┘
 *
 * Status dot colors:
 *   idle      → gray empty circle  ○
 *   thinking  → yellow pulsing dot ●
 *   active    → green pulsing dot  ●
 *   waiting   → blue dot           ●  (waiting for approval/message)
 *   error     → red dot            ●
 *   suspended → orange dot         ●  (budget exceeded)
 *
 * Activity text updates in real-time from AgentActivitySnapshot.activity.
 * On hover: show detail (e.g. "Reading src/components/Search.tsx")
 *
 * Cost bar: fills from left, color = green < 50%, yellow 50-80%, red > 80%.
 * No budget set → show raw cost without bar.
 */

// ─────────────────────────────────────────────────────────────────────────────
// E.4  ACTIVITY GRAPH (bottom of sidebar)
// ─────────────────────────────────────────────────────────────────────────────

export interface ActivityGraphProps {
	/** Activity snapshots for all agents, last 60 entries (1 per second). */
	history: Array<{
		timestamp: string;
		byAgent: Record<string, AgentStatus>;
	}>;
	members: Array<{ slug: string; color: string }>;
}

/**
 * ActivityGraph renders a sparkline-style activity chart.
 *
 * X axis: time (last 60 seconds)
 * Y axis: one row per agent
 * Cell: colored block when agent was active that second
 *
 * Colors:
 *   active   → green
 *   thinking → yellow
 *   waiting  → blue
 *   idle     → transparent (empty)
 *   error    → red
 *
 * This shows "token flow" — which agents are active at any given moment,
 * helping the human understand the team's parallel work pattern.
 */

// ─────────────────────────────────────────────────────────────────────────────
// E.5  MESSAGE TIMELINE COMPONENT PROPS
// ─────────────────────────────────────────────────────────────────────────────

export interface MessageTimelineProps {
	company: Company;
	messages: CompanyMessage[];
	channels: CompanyChannel[];
	activeChannel: string;
	tasks: CompanyTask[];
	pendingApprovals: ApprovalRequest[];
	onChannelChange: (slug: string) => void;
	/** Called when human sends a message */
	onSendMessage: (content: string) => void;
	/** Called when human clicks "Review Diff" on an approval card */
	onOpenApproval: (approvalId: string) => void;
}

/**
 * MessageTimeline renders:
 *
 * CHANNEL SELECTOR BAR:
 *   [#general ▾]  [#frontend]  [#backend]  [#qa]  [#decisions]
 *   Active channel is underlined. Unread count badge on others.
 *
 * MESSAGE LIST (virtualized for performance):
 *   ── Date separator ──
 *
 *   [🤖 avatar] architect  12:34 PM
 *   I'll break this into three tasks...
 *   ↳ Replied to: "Build a search feature"
 *   [@fe task-1] [@be task-2]
 *
 *   [🤖 avatar] fe  12:35 PM  · claude-sonnet model badge
 *   Claimed task-1: Add search input component
 *   ✅ @architect
 *
 *   ╔══ APPROVAL REQUEST ══════════════════════════════╗
 *   ║  🔔 fe wants to merge                            ║
 *   ║  Title: Add SearchInput component                ║
 *   ║  Branch: setra/company-abc123-fe                 ║
 *   ║  2 files changed · +145 -12 lines               ║
 *   ║  [👁 View Diff]   [✅ Approve]   [❌ Reject]   ║
 *   ╚══════════════════════════════════════════════════╝
 *
 * HUMAN INPUT BAR (bottom):
 *   [Type a message to the team... @mention to tag an agent]  [Send]
 *   Message goes to #activeChannel, from "human"
 *
 * Message kinds render differently:
 *   "text"      → standard chat bubble
 *   "status"    → small gray italic line (no bubble, no avatar)
 *   "task"      → task action card (claimed/completed/blocked)
 *   "approval"  → approval request card (with diff button + approve/reject)
 *   "decision"  → decision record card (green=approved, red=rejected)
 *   "human"     → highlighted bubble (different background color)
 *   "error"     → red warning card
 *   "cost-alert"→ orange warning card
 *
 * Agent avatars: generated identicons based on slug + a colored ring for status.
 * Human avatar: user's profile pic or initials.
 */

// ─────────────────────────────────────────────────────────────────────────────
// E.6  AGENT TERMINAL PANEL
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentTerminalPanelProps {
	/** Which agent's stream is shown. */
	activeSlug: string | null;
	members: Array<{ slug: string; name: string; status: AgentStatus }>;
	streams: Map<string, string[]>; // slug → last 500 lines
	onSelectAgent: (slug: string) => void;
}

/**
 * AgentTerminalPanel renders:
 *
 * AGENT SELECTOR TABS:
 *   [architect ● ]  [fe ○]  [be ○]  [qa ○]
 *   Green dot = active, gray = idle. Click to switch.
 *
 * STREAM OUTPUT:
 *   Raw JSON stream lines from the claude --output-format stream-json output.
 *   Rendered as a mini terminal (dark background, monospace, auto-scroll).
 *   Color codes: thinking = yellow, tool_calls = cyan, errors = red.
 *
 * APPROVAL QUEUE MINIBAR (pinned at bottom of panel):
 *   ╔══ APPROVAL QUEUE ══════════════╗
 *   ║  1 pending                     ║
 *   ║  [Review All Approvals]        ║
 *   ╚════════════════════════════════╝
 *   Shown when pendingApprovals.length > 0.
 *   Pulses red to attract attention.
 *   Click → opens the diff modal for the oldest pending approval.
 *
 * NOTE: This is NOT a full xterm.js terminal. It's a virtualized log viewer.
 * The actual agent process is running in a tmux session managed by the launcher.
 * This panel streams the agent's JSON output line-by-line via SSE.
 * For interactive terminal access, the user can open "Open in Full Terminal"
 * which opens a proper xterm.js panel attached to the tmux session.
 */

// ─────────────────────────────────────────────────────────────────────────────
// E.7  APPROVAL DIFF MODAL
// The primary human-in-the-loop interaction surface.
// ─────────────────────────────────────────────────────────────────────────────

export interface ApprovalDiffModalProps {
	approval: ApprovalRequest;
	/** Called with true=approved, false=rejected, plus optional human response. */
	onAnswer: (approved: boolean, humanResponse?: string) => void;
	onClose: () => void;
}

/**
 * ApprovalDiffModal renders (full-screen overlay):
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  APPROVAL REQUEST                                           [✕ Close]   ║
 * ║  From: @fe (Frontend Engineer) · 12:45 PM                              ║
 * ║  Title: Add SearchInput component with keyboard navigation             ║
 * ║                                                                          ║
 * ║  Description:                                                            ║
 * ║  Added the SearchInput component to src/components/Search/index.tsx.   ║
 * ║  Includes: keyboard shortcut (Cmd+K), ARIA labels, mobile-responsive.  ║
 * ║  Tests added in Search.test.tsx — all passing.                          ║
 * ║                                                                          ║
 * ╠══ DIFF: setra/company-abc123-fe → main ═══════════════════════════════╣
 * ║                                                                          ║
 * ║  2 files changed · +145 lines · -12 lines                              ║
 * ║                                                                          ║
 * ║  src/components/Search/index.tsx (new file)          +130 lines        ║
 * ║  ──────────────────────────────────────────────────                     ║
 * ║  + import React, { useState, useCallback } from 'react';               ║
 * ║  + import { Cmd } from '../icons/Cmd';                                  ║
 * ║  + export function SearchInput({ onSearch }: SearchProps) {            ║
 * ║  + ...                                                                   ║
 * ║                                                                          ║
 * ║  src/components/Search/Search.test.tsx (new file)     +15 lines        ║
 * ║  ──────────────────────────────────────────────────                     ║
 * ║  + describe('SearchInput', () => {                                       ║
 * ║  + ...                                                                   ║
 * ║                                                                          ║
 * ╠═══════════════════════════════════════════════════════════════════════╣
 * ║                                                                          ║
 * ║  Your response (optional):  [____________________________________]      ║
 * ║                                                                          ║
 * ║  [❌ Request Revisions]              [✅ Approve & Merge]              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Diff rendering:
 *   - Use @codemirror/merge or a simple line-diff renderer
 *   - Additions in green (#22c55e bg), deletions in red (#ef4444 bg)
 *   - File headers are collapsible
 *   - Large diffs (> 500 lines) are paginated
 *
 * Keyboard shortcuts:
 *   Cmd+Enter = Approve
 *   Escape    = Close (does NOT reject — just dismisses the modal)
 *   Cmd+R     = Open in external diff tool (uses git difftool)
 *
 * On Approve:
 *   1. POST /approvals/{id}/answer { status: "approved", humanResponse }
 *   2. Launcher merges the branch and notifies the agent
 *   3. Modal closes, a "decision" message appears in #decisions channel
 *
 * On Reject:
 *   1. Human response is REQUIRED (enforce with validation)
 *   2. POST /approvals/{id}/answer { status: "rejected", humanResponse }
 *   3. Launcher notifies the agent with the rejection + feedback
 *   4. Agent resumes and revises work
 */

// ─────────────────────────────────────────────────────────────────────────────
// E.8  IPC BRIDGE (contextBridge shape for company features)
// ─────────────────────────────────────────────────────────────────────────────

export interface CompanyIPC {
	/** Start a company run. Returns the runId. */
	startRun: (
		companyId: string,
		plotId: string,
		initialTask: string,
	) => Promise<string>;
	/** Stop an active run. */
	stopRun: (runId: string) => Promise<void>;
	/** Answer an approval request. */
	answerApproval: (
		runId: string,
		approvalId: string,
		approved: boolean,
		humanResponse?: string,
	) => Promise<void>;
	/** Send a human message to the team. */
	sendMessage: (
		runId: string,
		channel: string,
		content: string,
		tagged?: string[],
	) => Promise<void>;
	/** Get the full diff for an approval request (re-generate if not cached). */
	getDiff: (runId: string, approvalId: string) => Promise<string>;
	/** List companies saved in the DB. */
	listCompanies: () => Promise<
		Array<{
			id: string;
			name: string;
			description: string;
			templateSlug?: string;
		}>
	>;
	/** Import a company.json file from disk. */
	importCompany: (filePath: string) => Promise<string>; // returns company id
	/** Save a company definition to DB. */
	saveCompany: (company: Omit<Company, "id">) => Promise<string>;
	/** Subscribe to broker SSE events (forwarded via ipcRenderer). */
	onBrokerEvent: (callback: (event: BrokerSSEEvent) => void) => () => void; // returns unsubscribe
}

// ─────────────────────────────────────────────────────────────────────────────
// E.9  NOTIFICATION BADGES
// Badges shown in the main sidebar when company mode has items needing attention.
// ─────────────────────────────────────────────────────────────────────────────

export interface CompanyNotificationBadge {
	/** Number of pending approval requests. Shown as a red badge on the company icon. */
	pendingApprovals: number;
	/** Number of agents with errors. */
	agentErrors: number;
	/** Number of agents that have hit their budget and are suspended. */
	suspendedAgents: number;
	/** Whether any agent is currently active (used for the pulse animation on the icon). */
	hasActiveAgents: boolean;
}

/**
 * Where these badges appear in the main setra sidebar:
 *
 *   [🏢] Company Mode    (1) ← red badge = 1 pending approval
 *        └─ [Active run: Full Stack Dev]
 *             ├─ ● 3 agents active
 *             ├─ 🔔 1 approval pending  ← red notification dot
 *             └─ $1.24 / $5.00
 *
 * Desktop notification: when a new approval request arrives while
 * the Electron window is not focused, send an OS notification:
 *   Title: "setra — Approval Needed"
 *   Body:  "@fe wants to merge: Add SearchInput component"
 *   Click: focus window and open diff modal
 *
 * Also ring the OS notification bell (Electron's notification API).
 * This is the human-in-the-loop "tap on shoulder" moment.
 */

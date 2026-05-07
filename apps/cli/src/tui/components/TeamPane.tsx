/**
 * TeamPane — Ink-based TUI component for viewing team discussion.
 *
 * Layout:
 *   TEAM DISCUSSION ──────────────────────────────────
 *   ● pm  talking    │ pm (12:34:01): @be Let's review...
 *   ⚡ fe  working   │ arch (12:34:15): @pm Agreed.
 *   ◆ arch plotting  │ fe (12:34:22): Working on layout...
 *   ○  qa  lurking   │ be (12:34:30): DB schema updated.
 *   ─────────────────│──────────────────────────────────
 *   HEARTBEAT: 2s ●  │ [m] send message  [q] close
 */

import chalk from "chalk";
import { Box, Text, useInput, useStdout } from "ink";
import React, { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentStatus =
	| "idle"
	| "thinking"
	| "active"
	| "waiting"
	| "error"
	| "suspended";

interface AgentActivitySnapshot {
	slug: string;
	status: AgentStatus;
	activity: string;
	detail?: string;
	lastTime: string;
	costUsd: number;
}

interface CompanyMessage {
	id: string;
	channel: string;
	from: string;
	kind: string;
	content: string;
	tagged: string[];
	createdAt: string;
}

interface GetMessagesResponse {
	messages: CompanyMessage[];
}

interface GetActivityResponse {
	activity: AgentActivitySnapshot[];
}

// ─── Presence classification ──────────────────────────────────────────────────

type Presence =
	| "talking"
	| "working"
	| "plotting"
	| "blocked"
	| "lurking"
	| "thinking";

const TOOL_KEYWORDS = /\b(bash|edit|read|write|grep|glob|tool)\b/i;

function classifyPresence(snap: AgentActivitySnapshot): Presence {
	if (snap.status === "error" || snap.status === "suspended") return "blocked";
	if (snap.status === "thinking") return "thinking";
	const secsSince = snap.lastTime
		? (Date.now() - new Date(snap.lastTime).getTime()) / 1000
		: 999;
	if (
		snap.activity &&
		snap.activity !== "heartbeat" &&
		snap.activity !== "idle"
	) {
		if (secsSince < 10) return "talking";
		if (secsSince < 30)
			return TOOL_KEYWORDS.test(snap.activity) ? "working" : "plotting";
	}
	if (secsSince < 10) return "talking";
	if (secsSince < 30)
		return TOOL_KEYWORDS.test(snap.activity) ? "working" : "plotting";
	return "lurking";
}

function presenceDot(p: Presence): string {
	switch (p) {
		case "talking":
			return chalk.blue("●");
		case "working":
			return chalk.green("⚡");
		case "plotting":
			return chalk.magenta("◆");
		case "blocked":
			return chalk.red("●");
		case "lurking":
			return chalk.gray("○");
		case "thinking":
			return chalk.cyan("⋯");
	}
}

function presenceLabel(p: Presence): string {
	switch (p) {
		case "talking":
			return chalk.blue("talking");
		case "working":
			return chalk.green("working");
		case "plotting":
			return chalk.magenta("plotting");
		case "blocked":
			return chalk.red("blocked");
		case "lurking":
			return chalk.gray("lurking");
		case "thinking":
			return chalk.cyan("thinking");
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
	try {
		return new Date(iso).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	} catch {
		return "??:??:??";
	}
}

function relativeSeconds(iso: string | null): string {
	if (!iso) return "never";
	const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	return `${Math.floor(m / 60)}h`;
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max - 1) + "…";
}

// Highlight @mentions in a message content string (chalk-based)
function highlightMentions(content: string): string {
	return content.replace(/@([a-z0-9-]{2,20})/gi, (_, slug) =>
		chalk.blue(`@${slug}`),
	);
}

// ─── Component props ──────────────────────────────────────────────────────────

interface TeamPaneProps {
	brokerPort: number;
	brokerToken: string;
	channel?: string;
	width: number;
	height: number;
	focused: boolean;
	onClose?: () => void;
}

// ─── TeamPane ─────────────────────────────────────────────────────────────────

export function TeamPane({
	brokerPort,
	brokerToken,
	channel = "general",
	width,
	height,
	focused,
	onClose,
}: TeamPaneProps) {
	const [messages, setMessages] = useState<CompanyMessage[]>([]);
	const [agents, setAgents] = useState<AgentActivitySnapshot[]>([]);
	const [scroll, setScroll] = useState(0); // offset from bottom
	const [lastPoll, setLastPoll] = useState<string | null>(null);
	const seenIds = useRef(new Set<string>());

	const baseUrl = `http://localhost:${brokerPort}`;
	const headers = { Authorization: `Bearer ${brokerToken}` };

	// ── Poll messages every 2s ──────────────────────────────────────────────
	useEffect(() => {
		let active = true;

		async function poll() {
			try {
				const resp = await fetch(
					`${baseUrl}/messages?channel=${encodeURIComponent(channel)}&limit=50`,
					{ headers },
				);
				if (!resp.ok) return;
				const data = (await resp.json()) as GetMessagesResponse;
				const newMsgs = (data.messages ?? []).filter(
					(m) => !seenIds.current.has(m.id),
				);
				for (const m of newMsgs) seenIds.current.add(m.id);
				if (newMsgs.length > 0) {
					setMessages((prev) => [...prev, ...newMsgs].slice(-200));
				}
				setLastPoll(new Date().toISOString());
			} catch {
				// broker not reachable yet — silently retry
			}
		}

		void poll();
		const t = setInterval(() => {
			if (active) void poll();
		}, 2_000);
		return () => {
			active = false;
			clearInterval(t);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [brokerPort, brokerToken, channel]);

	// ── Poll agent activity every 5s ────────────────────────────────────────
	useEffect(() => {
		let active = true;

		async function pollActivity() {
			try {
				const resp = await fetch(`${baseUrl}/agent-activity`, { headers });
				if (!resp.ok) return;
				const data = (await resp.json()) as GetActivityResponse;
				setAgents(data.activity ?? []);
			} catch {
				// ignore
			}
		}

		void pollActivity();
		const t = setInterval(() => {
			if (active) void pollActivity();
		}, 5_000);
		return () => {
			active = false;
			clearInterval(t);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [brokerPort, brokerToken]);

	// ── Keyboard navigation ─────────────────────────────────────────────────
	useInput(
		useCallback(
			(input, key) => {
				if (!focused) return;
				if (input === "q" || key.escape) {
					onClose?.();
					return;
				}
				if (key.upArrow) {
					setScroll((s) =>
						Math.min(s + 1, Math.max(0, messages.length - visibleLines)),
					);
				}
				if (key.downArrow) {
					setScroll((s) => Math.max(0, s - 1));
				}
			},
			[focused, messages.length, onClose],
		),
	);

	// ── Layout geometry ─────────────────────────────────────────────────────
	const SIDEBAR_W = Math.min(22, Math.floor(width * 0.25));
	const FEED_W = width - SIDEBAR_W - 1; // -1 for separator
	const HEADER_H = 1;
	const FOOTER_H = 1;
	const visibleLines = height - HEADER_H - FOOTER_H - 2;

	// ── Build visible message lines ─────────────────────────────────────────
	const allLines: string[] = [];
	for (const msg of messages) {
		const timeStr = formatTime(msg.createdAt);
		const prefix = chalk.gray(`${msg.from} (${timeStr}): `);
		const body = highlightMentions(
			truncate(msg.content.replace(/\n/g, " "), FEED_W - 2),
		);
		allLines.push(prefix + body);
	}
	const visStart = Math.max(0, allLines.length - visibleLines - scroll);
	const visEnd = Math.max(0, allLines.length - scroll);
	const visLines = allLines.slice(visStart, visEnd);
	while (visLines.length < visibleLines) visLines.push("");

	// ── Build sidebar agent lines ───────────────────────────────────────────
	const sortedAgents = [...agents].sort((a, b) => {
		const order: Record<AgentStatus, number> = {
			thinking: 0,
			active: 1,
			waiting: 2,
			idle: 3,
			error: 4,
			suspended: 5,
		};
		return (order[a.status] ?? 9) - (order[b.status] ?? 9);
	});
	const sidebarLines: string[] = [];
	for (const snap of sortedAgents) {
		const p = classifyPresence(snap);
		const dot = presenceDot(p);
		const lbl = presenceLabel(p);
		const row = `${dot} ${truncate(snap.slug, SIDEBAR_W - 12).padEnd(SIDEBAR_W - 12)} ${lbl}`;
		sidebarLines.push(row);
	}
	while (sidebarLines.length < visibleLines) sidebarLines.push("");

	const sep = chalk.gray("│");

	return (
		<Box flexDirection="column" width={width} height={height}>
			{/* Header */}
			<Box>
				<Text bold color="#4f7eff">
					{"TEAM DISCUSSION "}
				</Text>
				<Text color="#30363d">{"─".repeat(Math.max(0, width - 18))}</Text>
			</Box>

			{/* Body rows */}
			{visLines.map((line, i) => (
				<Box key={i} flexDirection="row">
					{/* Sidebar */}
					<Text>{sidebarLines[i] ?? " ".repeat(SIDEBAR_W)}</Text>

					{/* Separator */}
					<Text>{sep}</Text>

					{/* Feed */}
					<Text> {line}</Text>
				</Box>
			))}

			{/* Footer */}
			<Box>
				<Text color="#30363d">{"─".repeat(SIDEBAR_W)}</Text>
				<Text>{sep}</Text>
				<Text color="#30363d">{"─".repeat(Math.max(0, FEED_W))}</Text>
			</Box>
			<Box>
				<Text color="#8b949e">
					{"POLL: "}
					{relativeSeconds(lastPoll)}
					{"  "}
					{chalk.green("●")}
					{"  "}
				</Text>
				<Text color="#8b949e">
					{sep}
					{"  "}
					{chalk.blue("[↑↓]")} scroll {chalk.blue("[q]")} close
				</Text>
			</Box>
		</Box>
	);
}

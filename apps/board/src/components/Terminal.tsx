import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

type TerminalProps = {
	sessionId?: string;
	projectId?: string;
	className?: string;
};

const textDecoder = new TextDecoder();

export function Terminal({ sessionId, projectId, className }: TerminalProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		container.innerHTML = "";
		const term = new XTerm({
			convertEol: true,
			cursorBlink: true,
			fontFamily: '"JetBrains Mono", Menlo, monospace',
			fontSize: 13,
			lineHeight: 1.3,
			theme: {
				background: "#1a1a2e",
				foreground: "#e0e0e0",
				cursor: "#7c5cfc",
				selectionBackground: "#7c5cfc55",
				black: "#151521",
				brightBlack: "#4b5563",
				red: "#ef4444",
				green: "#22c55e",
				yellow: "#f59e0b",
				blue: "#60a5fa",
				magenta: "#a855f7",
				cyan: "#22d3ee",
				white: "#f8fafc",
				brightWhite: "#ffffff",
			},
		});
		const fitAddon = new FitAddon();
		const webLinksAddon = new WebLinksAddon();
		term.loadAddon(fitAddon);
		term.loadAddon(webLinksAddon);
		term.open(container);
		term.focus();
		fitAddon.fit();

		let socket: WebSocket | null = null;
		let socketOpened = false;
		let fallbackEnabled = false;
		let currentLine = "";
		let inputDisposable: { dispose: () => void } | null = null;

		const writePrompt = () => term.write("\r\n$ ");
		const setInputHandler = (handler: (data: string) => void) => {
			inputDisposable?.dispose();
			inputDisposable = term.onData(handler);
		};

		const enableLocalEcho = (reason?: string) => {
			if (fallbackEnabled) return;
			fallbackEnabled = true;
			term.writeln("");
			term.writeln("\x1b[36msetra terminal fallback\x1b[0m");
			if (reason) term.writeln(`\x1b[33m${reason}\x1b[0m`);
			if (projectId) term.writeln(`project: ${projectId}`);
			term.writeln(
				"Type to locally echo input while the WebSocket backend is unavailable.",
			);
			term.write("$ ");
			setInputHandler((data) => {
				switch (data) {
					case "\r":
						term.write(`\r\nlocal echo: ${currentLine}`);
						currentLine = "";
						writePrompt();
						break;
					case "\u007f":
						if (currentLine.length > 0) {
							currentLine = currentLine.slice(0, -1);
							term.write("\b \b");
						}
						break;
					default:
						if (data >= " " || data === "\t") {
							currentLine += data;
							term.write(data);
						}
				}
			});
		};

		const resize = () => {
			fitAddon.fit();
			if (socket?.readyState === WebSocket.OPEN) {
				socket.send(
					JSON.stringify({
						type: "resize",
						cols: term.cols,
						rows: term.rows,
					}),
				);
			}
		};

		const resizeObserver = new ResizeObserver(() => resize());
		resizeObserver.observe(container);

		if (sessionId) {
			term.writeln(`Connecting to session ${sessionId}…`);
			try {
				socket = new WebSocket(
					`ws://localhost:3141/api/terminal/ws/${sessionId}`,
				);
				setInputHandler((data) => {
					if (socket?.readyState === WebSocket.OPEN) socket.send(data);
				});
				socket.onopen = () => {
					socketOpened = true;
					term.writeln("Connected.");
					resize();
				};
				socket.onmessage = (event) => {
					if (typeof event.data === "string") {
						term.write(event.data);
						return;
					}
					if (event.data instanceof ArrayBuffer) {
						term.write(textDecoder.decode(event.data));
						return;
					}
					if (event.data instanceof Blob) {
						void event.data.text().then((text) => term.write(text));
					}
				};
				socket.onerror = () => {
					if (!socketOpened) {
						enableLocalEcho(
							"WebSocket unavailable. Falling back to local echo mode.",
						);
					}
				};
				socket.onclose = () => {
					if (!socketOpened) {
						enableLocalEcho("Terminal backend did not accept the connection.");
						return;
					}
					term.writeln("\r\nConnection closed.");
				};
			} catch {
				enableLocalEcho("Terminal backend is not available right now.");
			}
		} else {
			enableLocalEcho("No session selected.");
		}

		return () => {
			resizeObserver.disconnect();
			inputDisposable?.dispose();
			if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
			term.dispose();
		};
	}, [projectId, sessionId]);

	return (
		<div
			className={cn(
				"h-full w-full overflow-hidden rounded-xl border border-border/50 bg-[#1a1a2e]",
				className,
			)}
		>
			<div ref={containerRef} className="h-full w-full p-3" />
		</div>
	);
}

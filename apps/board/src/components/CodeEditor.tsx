import { autocompletion } from "@codemirror/autocomplete";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { bracketMatching, foldGutter } from "@codemirror/language";
import {
	highlightSelectionMatches,
	openSearchPanel,
	search,
} from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

export interface CodeEditorProps {
	value: string;
	onChange?: (value: string) => void;
	onCursorChange?: (position: { line: number; column: number }) => void;
	language?: string;
	readOnly?: boolean;
	className?: string;
	fontSize?: number;
	tabSize?: number;
	wordWrap?: boolean;
	jumpTo?: { line: number; column?: number; token: number } | null;
}

function getLanguageExtension(language?: string): Extension {
	const ext = language?.trim().toLowerCase().replace(/^\./, "");

	switch (ext) {
		case "ts":
			return javascript({ typescript: true });
		case "tsx":
			return javascript({ typescript: true, jsx: true });
		case "js":
		case "mjs":
		case "cjs":
			return javascript();
		case "jsx":
			return javascript({ jsx: true });
		case "py":
			return python();
		case "json":
			return json();
		case "html":
		case "htm":
		case "svelte":
		case "vue":
			return html();
		case "css":
		case "scss":
		case "sass":
		case "less":
			return css();
		case "md":
		case "mdx":
			return markdown();
		default:
			return [];
	}
}

function createEditorTheme(fontSize: number): Extension {
	return EditorView.theme({
		"&": {
			height: "100%",
			flex: "1 1 auto",
			backgroundColor: "#0E1525",
			color: "#F5F9FC",
			fontSize: `${fontSize}px`,
			minHeight: 0,
		},
		"&.cm-focused": {
			outline: "none",
		},
		".cm-scroller": {
			flex: "1 1 auto",
			overflow: "auto",
			fontFamily:
				'"Fira Code", "JetBrains Mono", "Cascadia Code", Menlo, monospace',
			lineHeight: "1.6",
			scrollbarWidth: "thin",
			scrollbarColor: "#2B3245 transparent",
		},
		".cm-scroller::-webkit-scrollbar": {
			width: "8px",
			height: "8px",
		},
		".cm-scroller::-webkit-scrollbar-track": {
			backgroundColor: "transparent",
		},
		".cm-scroller::-webkit-scrollbar-thumb": {
			backgroundColor: "#2B3245",
			borderRadius: "9999px",
		},
		".cm-scroller::-webkit-scrollbar-thumb:hover": {
			backgroundColor: "#3C455C",
		},
		".cm-content": {
			padding: "8px 0",
			caretColor: "#F5F9FC",
		},
		".cm-line": {
			padding: "0 16px",
		},
		".cm-gutters": {
			backgroundColor: "#0E1525",
			color: "#5F6B7A",
			borderRight: "1px solid #2B3245",
			textAlign: "right",
			minWidth: "50px",
		},
		".cm-gutter": {
			backgroundColor: "transparent",
		},
		".cm-gutterElement": {
			padding: "0 14px 0 10px",
			userSelect: "none",
		},
		".cm-activeLine": {
			backgroundColor: "#1C2333",
		},
		".cm-activeLineGutter": {
			backgroundColor: "#1C2333",
			color: "#F5F9FC",
		},
		".cm-cursor, .cm-dropCursor": {
			borderLeftColor: "#F5F9FC",
		},
		".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
			{
				backgroundColor: "rgba(0, 121, 242, 0.3)",
			},
		".cm-panels": {
			backgroundColor: "#1C2333",
			color: "#F5F9FC",
			borderBottom: "1px solid #2B3245",
		},
		".cm-searchMatch": {
			backgroundColor: "rgba(0, 121, 242, 0.18)",
			outline: "1px solid rgba(0, 121, 242, 0.4)",
		},
		".cm-searchMatch.cm-searchMatch-selected": {
			backgroundColor: "rgba(0, 121, 242, 0.3)",
		},
	});
}

export function CodeEditor({
	value,
	onChange,
	onCursorChange,
	language,
	readOnly = false,
	className,
	fontSize = 14,
	tabSize = 2,
	wordWrap = false,
	jumpTo = null,
}: CodeEditorProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const valueRef = useRef(value);
	const onChangeRef = useRef(onChange);
	const onCursorChangeRef = useRef(onCursorChange);
	const suppressChangeRef = useRef(false);
	const languageCompartmentRef = useRef(new Compartment());
	const editableCompartmentRef = useRef(new Compartment());
	const tabSizeCompartmentRef = useRef(new Compartment());
	const themeCompartmentRef = useRef(new Compartment());
	const wrapCompartmentRef = useRef(new Compartment());

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	useEffect(() => {
		onCursorChangeRef.current = onCursorChange;
	}, [onCursorChange]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const startState = EditorState.create({
			doc: valueRef.current,
			extensions: [
				lineNumbers(),
				highlightActiveLine(),
				highlightActiveLineGutter(),
				bracketMatching(),
				autocompletion(),
				search(),
				highlightSelectionMatches(),
				foldGutter(),
				oneDark,
				themeCompartmentRef.current.of(createEditorTheme(fontSize)),
				languageCompartmentRef.current.of(getLanguageExtension(language)),
				tabSizeCompartmentRef.current.of(EditorState.tabSize.of(tabSize)),
				wrapCompartmentRef.current.of(wordWrap ? EditorView.lineWrapping : []),
				editableCompartmentRef.current.of([
					EditorState.readOnly.of(readOnly),
					EditorView.editable.of(!readOnly),
				]),
				EditorView.updateListener.of((update) => {
					if (update.selectionSet || update.focusChanged) {
						const head = update.state.selection.main.head;
						const line = update.state.doc.lineAt(head);
						onCursorChangeRef.current?.({
							line: line.number,
							column: head - line.from + 1,
						});
					}
					if (!update.docChanged) return;
					const nextValue = update.state.doc.toString();
					valueRef.current = nextValue;
					if (suppressChangeRef.current) {
						suppressChangeRef.current = false;
						return;
					}
					onChangeRef.current?.(nextValue);
				}),
				EditorView.domEventHandlers({
					keydown(event, editorView) {
						if (
							(event.metaKey || event.ctrlKey) &&
							event.key.toLowerCase() === "f"
						) {
							event.preventDefault();
							return openSearchPanel(editorView);
						}
						return false;
					},
				}),
			],
		});

		const view = new EditorView({
			state: startState,
			parent: container,
		});

		viewRef.current = view;
		const head = view.state.selection.main.head;
		const line = view.state.doc.lineAt(head);
		onCursorChangeRef.current?.({
			line: line.number,
			column: head - line.from + 1,
		});

		return () => {
			view.destroy();
			viewRef.current = null;
		};
	}, []);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;

		view.dispatch({
			effects: languageCompartmentRef.current.reconfigure(
				getLanguageExtension(language),
			),
		});
	}, [language]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;

		view.dispatch({
			effects: editableCompartmentRef.current.reconfigure([
				EditorState.readOnly.of(readOnly),
				EditorView.editable.of(!readOnly),
			]),
		});
	}, [readOnly]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		view.dispatch({
			effects: themeCompartmentRef.current.reconfigure(
				createEditorTheme(fontSize),
			),
		});
	}, [fontSize]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		view.dispatch({
			effects: tabSizeCompartmentRef.current.reconfigure(
				EditorState.tabSize.of(tabSize),
			),
		});
	}, [tabSize]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		view.dispatch({
			effects: wrapCompartmentRef.current.reconfigure(
				wordWrap ? EditorView.lineWrapping : [],
			),
		});
	}, [wordWrap]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view || value === valueRef.current) return;

		suppressChangeRef.current = true;
		valueRef.current = value;
		view.dispatch({
			changes: {
				from: 0,
				to: view.state.doc.length,
				insert: value,
			},
		});
	}, [value]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view || !jumpTo) return;
		const line = Math.max(1, Math.min(jumpTo.line, view.state.doc.lines));
		const lineInfo = view.state.doc.line(line);
		const columnOffset = Math.max(0, (jumpTo.column ?? 1) - 1);
		const target = Math.min(lineInfo.to, lineInfo.from + columnOffset);
		view.dispatch({
			selection: { anchor: target },
			effects: EditorView.scrollIntoView(target, { y: "center" }),
		});
		view.focus();
	}, [jumpTo]);

	return (
		<div
			ref={containerRef}
			className={cn(
				"flex h-full min-h-0 w-full flex-1 overflow-hidden",
				className,
			)}
		/>
	);
}

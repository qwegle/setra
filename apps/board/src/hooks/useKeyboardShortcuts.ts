import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDialogActions } from "../context/DialogContext";

interface UseKeyboardShortcutsOptions {
	onToggleSidebar?: () => void;
}

const NAV_MAP: Record<string, string> = {
	"1": "/overview",
	"2": "/projects",
	"3": "/agents",
	"4": "/collaboration",
	"5": "/clone",
	"6": "/costs",
	"7": "/settings",
};

export function useKeyboardShortcuts({
	onToggleSidebar,
}: UseKeyboardShortcutsOptions = {}) {
	const navigate = useNavigate();
	const { openCommandPalette, openShortcutsModal } = useDialogActions();

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			const meta = e.metaKey || e.ctrlKey;
			const key = e.key;

			// Skip if user is typing in an input/textarea/contenteditable
			const target = e.target as HTMLElement;
			const isEditing =
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.isContentEditable;

			if (meta) {
				switch (key) {
					case "k":
						e.preventDefault();
						openCommandPalette();
						return;
					case "/":
						e.preventDefault();
						openShortcutsModal();
						return;
					case "b":
						e.preventDefault();
						onToggleSidebar?.();
						return;
					case ",":
						e.preventDefault();
						navigate("/settings");
						return;
					case "n":
						e.preventDefault();
						window.dispatchEvent(new CustomEvent("setra:new-item"));
						return;
				}
				// Cmd+1..7 navigation
				if (NAV_MAP[key]) {
					e.preventDefault();
					navigate(NAV_MAP[key]);
					return;
				}
			}

			if (!isEditing) {
				if (key === "Escape") {
					window.dispatchEvent(new CustomEvent("setra:escape"));
				}
			}
		},
		[navigate, openCommandPalette, openShortcutsModal, onToggleSidebar],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);
}

import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import { Button } from "./Button";

export interface ModalProps {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	actions?: ReactNode;
	size?: "sm" | "md" | "lg";
}

const sizeClasses = {
	sm: "max-w-sm",
	md: "max-w-lg",
	lg: "max-w-2xl",
};

const focusSelector = [
	"a[href]",
	"button:not([disabled])",
	"textarea:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

export function Modal({
	open,
	onClose,
	title,
	children,
	actions,
	size = "md",
}: ModalProps) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const titleId = useId();

	useEffect(() => {
		if (!open) return;
		const previousActive = document.activeElement as HTMLElement | null;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		const focusables = Array.from(
			dialogRef.current?.querySelectorAll<HTMLElement>(focusSelector) ?? [],
		).filter((element) => !element.hasAttribute("disabled"));
		const firstFocusable = focusables[0];
		(firstFocusable ?? dialogRef.current)?.focus();

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
				return;
			}
			if (event.key !== "Tab") return;
			const nodes = Array.from(
				dialogRef.current?.querySelectorAll<HTMLElement>(focusSelector) ?? [],
			).filter((element) => !element.hasAttribute("disabled"));
			if (nodes.length === 0) {
				event.preventDefault();
				return;
			}
			const first = nodes[0];
			const last = nodes[nodes.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last?.focus();
			}
			if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first?.focus();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			document.body.style.overflow = previousOverflow;
			previousActive?.focus();
		};
	}, [open, onClose]);

	if (!open || typeof document === "undefined") return null;

	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className={cn(
					"mx-4 w-full rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-2xl outline-none md:mx-auto max-h-[90vh] flex flex-col",
					sizeClasses[size],
				)}
			>
				<div className="mb-4 flex items-start justify-between gap-4 flex-shrink-0">
					<h2 id={titleId} className="text-lg font-semibold text-white">
						{title}
					</h2>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onClose}
						aria-label="Close dialog"
					>
						<X className="h-4 w-4" aria-hidden="true" />
					</Button>
				</div>
				<div className="space-y-4 overflow-y-auto min-h-0">{children}</div>
				{actions && (
					<div className="mt-6 flex justify-end gap-2 flex-shrink-0">
						{actions}
					</div>
				)}
			</div>
		</div>,
		document.body,
	);
}

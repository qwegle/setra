import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
	variant?: "default" | "success" | "warning" | "danger" | "info";
	children: ReactNode;
}

const variants = {
	default: "border-zinc-700 bg-zinc-800 text-zinc-300",
	success: "border-green-500/30 bg-green-500/15 text-green-300",
	warning: "border-yellow-500/30 bg-yellow-500/15 text-yellow-300",
	danger: "border-red-500/30 bg-red-500/15 text-red-300",
	info: "border-blue-500/30 bg-blue-500/15 text-blue-300",
};

export function Badge({
	variant = "default",
	children,
	className,
	...props
}: BadgeProps) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
				variants[variant],
				className,
			)}
			{...props}
		>
			{children}
		</span>
	);
}

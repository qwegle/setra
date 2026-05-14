import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
	variant?: "default" | "success" | "warning" | "danger" | "info";
	children: ReactNode;
}

const variants = {
	default: "border-[#d9c6a3] bg-white text-[#4b3f2d]",
	success: "border-green-500/30 bg-green-500/15 text-green-300",
	warning: "border-yellow-500/30 bg-yellow-500/15 text-yellow-300",
	danger: "border-red-500/30 bg-red-500/15 text-red-300",
	info: "border-[#c9a25f]/30 bg-[#7a5421]/15 text-[#7a5421]",
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

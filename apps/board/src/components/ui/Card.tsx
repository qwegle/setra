import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface CardProps {
	title?: string;
	subtitle?: string;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
}

export function Card({
	title,
	subtitle,
	actions,
	children,
	className,
}: CardProps) {
	return (
		<section
			className={cn(
				"bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-4",
				className,
			)}
		>
			{(title || subtitle || actions) && (
				<div className="mb-4 flex items-start justify-between gap-4">
					<div className="space-y-1">
						{title && (
							<h2 className="text-base font-semibold text-white">{title}</h2>
						)}
						{subtitle && <p className="text-sm text-zinc-400">{subtitle}</p>}
					</div>
					{actions && <div className="flex items-center gap-2">{actions}</div>}
				</div>
			)}
			{children}
		</section>
	);
}

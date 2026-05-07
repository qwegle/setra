import type { ReactNode } from "react";

export interface EmptyStateProps {
	icon?: ReactNode;
	title: string;
	description?: string;
	action?: ReactNode;
}

export function EmptyState({
	icon,
	title,
	description,
	action,
}: EmptyStateProps) {
	return (
		<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 px-6 py-12 text-center">
			{icon && <div className="mb-4 text-zinc-500">{icon}</div>}
			<h3 className="text-base font-semibold text-white">{title}</h3>
			{description && (
				<p className="mt-2 max-w-md text-sm text-zinc-400">{description}</p>
			)}
			{action && <div className="mt-4">{action}</div>}
		</div>
	);
}

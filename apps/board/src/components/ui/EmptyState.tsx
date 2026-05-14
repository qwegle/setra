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
		<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#d9c6a3] bg-[#faf3e3]/40 px-6 py-12 text-center">
			{icon && <div className="mb-4 text-[#8a7a5c]">{icon}</div>}
			<h3 className="text-base font-semibold text-[#2b2418]">{title}</h3>
			{description && (
				<p className="mt-2 max-w-md text-sm text-[#6f6044]">{description}</p>
			)}
			{action && <div className="mt-4">{action}</div>}
		</div>
	);
}

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface PageHeaderProps {
	title: string;
	subtitle?: string | undefined;
	actions?: ReactNode | undefined;
	breadcrumbs?: { label: string; href?: string | undefined }[] | undefined;
}

export function PageHeader({
	title,
	subtitle,
	actions,
	breadcrumbs,
}: PageHeaderProps) {
	return (
		<div className="space-y-3">
			{breadcrumbs && breadcrumbs.length > 0 && (
				<nav
					aria-label="Breadcrumb"
					className="flex items-center gap-1 text-sm text-[#6f6044]"
				>
					{breadcrumbs.map((crumb, index) => (
						<div
							key={`${crumb.label}-${index}`}
							className="flex items-center gap-1"
						>
							{crumb.href ? (
								<Link
									to={crumb.href}
									className="hover:text-[#3b3224] transition-colors"
								>
									{crumb.label}
								</Link>
							) : (
								<span>{crumb.label}</span>
							)}
							{index < breadcrumbs.length - 1 && (
								<ChevronRight className="h-4 w-4" aria-hidden="true" />
							)}
						</div>
					))}
				</nav>
			)}
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="space-y-1">
					<h1 className="text-xl font-semibold text-[#2b2418]">{title}</h1>
					{subtitle && <p className="text-sm text-[#6f6044]">{subtitle}</p>}
				</div>
				{actions && (
					<div className="flex flex-wrap items-center gap-2">{actions}</div>
				)}
			</div>
		</div>
	);
}

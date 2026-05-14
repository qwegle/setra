import {
	type ReactElement,
	type ReactNode,
	cloneElement,
	isValidElement,
	useId,
	useState,
} from "react";

export interface TooltipProps {
	content: ReactNode;
	children: ReactElement;
}

export function Tooltip({ content, children }: TooltipProps) {
	const [open, setOpen] = useState(false);
	const tooltipId = useId();

	if (!isValidElement(children)) return children;
	const child = children as ReactElement<Record<string, unknown>>;

	return (
		<span className="relative inline-flex">
			{cloneElement(child, {
				...(open ? { "aria-describedby": tooltipId } : {}),
				onFocus: () => setOpen(true),
				onBlur: () => setOpen(false),
				onMouseEnter: () => setOpen(true),
				onMouseLeave: () => setOpen(false),
			})}
			{open && (
				<span
					id={tooltipId}
					role="tooltip"
					className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-[#fdfaf3] px-2 py-1 text-xs text-[#2b2418] shadow-lg"
				>
					{content}
				</span>
			)}
		</span>
	);
}

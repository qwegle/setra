import { cn } from "../../lib/utils";

export interface SkeletonProps {
	width?: string;
	height?: string;
	variant?: "text" | "rect" | "circle";
	count?: number;
	className?: string;
}

export function Skeleton({
	width,
	height,
	variant = "text",
	count = 1,
	className,
}: SkeletonProps) {
	const baseClass =
		variant === "circle"
			? "rounded-full"
			: variant === "rect"
				? "rounded-lg"
				: "rounded h-4";
	const style = {
		...(width ? { width } : {}),
		...(height ? { height } : {}),
	};

	return (
		<div className="space-y-2">
			{Array.from({ length: count }).map((_, index) => (
				<div
					key={index}
					className={cn("animate-pulse bg-white/80", baseClass, className)}
					style={style}
				/>
			))}
		</div>
	);
}

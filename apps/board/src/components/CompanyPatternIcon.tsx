import { cn } from "../lib/utils";

interface Props {
	companyName: string;
	logoUrl?: string | null | undefined;
	brandColor?: string | undefined;
	size?: "sm" | "md" | "lg" | "xl" | undefined;
	className?: string | undefined;
}

const SIZE_PX: Record<NonNullable<Props["size"]>, number> = {
	sm: 24,
	md: 32,
	lg: 40,
	xl: 48,
};

const SIZE_TEXT: Record<NonNullable<Props["size"]>, string> = {
	sm: "text-[9px]",
	md: "text-xs",
	lg: "text-sm",
	xl: "text-base",
};

export function CompanyPatternIcon({
	companyName,
	logoUrl,
	brandColor = "#2563eb",
	size = "md",
	className,
}: Props) {
	const px = SIZE_PX[size];
	const initials = companyName.slice(0, 2).toUpperCase();

	return (
		<div
			className={cn(
				"relative shrink-0 overflow-hidden transition-all duration-200",
				"rounded-[22px] hover:rounded-[14px]",
				className,
			)}
			style={{ width: px, height: px }}
		>
			{logoUrl ? (
				<img
					src={logoUrl}
					alt={companyName}
					className="w-full h-full object-cover"
					draggable={false}
				/>
			) : (
				<div
					className={cn(
						"flex items-center justify-center w-full h-full font-semibold text-[#2b2418] select-none",
						SIZE_TEXT[size],
					)}
					style={{ backgroundColor: brandColor }}
				>
					{initials}
				</div>
			)}
		</div>
	);
}

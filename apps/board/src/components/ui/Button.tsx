import { Loader2 } from "lucide-react";
import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from "react";
import { cn } from "../../lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "primary" | "secondary" | "ghost" | "danger";
	size?: "sm" | "md" | "lg";
	loading?: boolean;
	icon?: ReactNode;
}

const variantClasses = {
	primary: "bg-[#2b2418] text-[#fbf6ec] hover:bg-[#3d3324] shadow-sm",
	secondary:
		"border border-[#d9c6a3] bg-white text-[#2b2418] hover:bg-[#faf3e3]",
	ghost: "bg-transparent text-[#3d3324] hover:bg-[#f3e7cf]",
	danger: "bg-[#a8362b] text-[#2b2418] hover:bg-[#8e2f23]",
};

const sizeClasses = {
	sm: "h-8 px-3 text-xs",
	md: "h-10 px-4 py-2 text-sm",
	lg: "h-11 px-5 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			className,
			variant = "primary",
			size = "md",
			loading = false,
			icon,
			disabled,
			children,
			...props
		},
		ref,
	) => (
		<button
			ref={ref}
			className={cn(
				"inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e2c787] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fbf6ec] disabled:pointer-events-none disabled:opacity-50",
				variantClasses[variant],
				sizeClasses[size],
				className,
			)}
			disabled={disabled || loading}
			{...props}
		>
			{loading ? (
				<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
			) : (
				icon
			)}
			{children}
		</button>
	),
);

Button.displayName = "Button";

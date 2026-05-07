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
	primary: "bg-blue-600 text-white hover:bg-blue-700",
	secondary:
		"border border-zinc-700 bg-zinc-900/60 text-zinc-100 hover:bg-zinc-800/80",
	ghost: "bg-transparent text-zinc-200 hover:bg-zinc-800/70",
	danger: "bg-red-600 text-white hover:bg-red-700",
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
				"inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:pointer-events-none disabled:opacity-50",
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

import {
	type ReactNode,
	type SelectHTMLAttributes,
	forwardRef,
	useId,
} from "react";
import { cn } from "../../lib/utils";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
	label?: string;
	error?: string;
	helperText?: string;
	children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
	({ id, label, error, helperText, className, children, ...props }, ref) => {
		const generatedId = useId();
		const selectId = id ?? generatedId;
		const helperId = `${selectId}-helper`;
		const errorId = `${selectId}-error`;

		return (
			<div className="space-y-1.5">
				{label && (
					<label
						htmlFor={selectId}
						className="text-sm font-medium text-[#2b2418]"
					>
						{label}
					</label>
				)}
				<select
					ref={ref}
					id={selectId}
					aria-invalid={Boolean(error)}
					aria-describedby={error ? errorId : helperText ? helperId : undefined}
					className={cn(
						"w-full rounded-md border bg-[#faf3e3]/70 px-3 py-2 text-sm text-[#2b2418] outline-none transition focus-visible:ring-2 focus-visible:ring-[#e2c787] focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
						error
							? "border-red-500/60"
							: "border-[#d9c6a3] focus-visible:border-[#c9a25f]",
						className,
					)}
					{...props}
				>
					{children}
				</select>
				{error ? (
					<p id={errorId} className="text-sm text-red-400">
						{error}
					</p>
				) : helperText ? (
					<p id={helperId} className="text-sm text-[#6f6044]">
						{helperText}
					</p>
				) : null}
			</div>
		);
	},
);

Select.displayName = "Select";

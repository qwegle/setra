import { type InputHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "../../lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
	label?: string | undefined;
	error?: string | undefined;
	helperText?: string | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
	({ id, label, error, helperText, className, ...props }, ref) => {
		const generatedId = useId();
		const inputId = id ?? generatedId;
		const helperId = `${inputId}-helper`;
		const errorId = `${inputId}-error`;

		return (
			<div className="space-y-1.5">
				{label && (
					<label
						htmlFor={inputId}
						className="text-sm font-medium text-zinc-100"
					>
						{label}
					</label>
				)}
				<input
					ref={ref}
					id={inputId}
					aria-invalid={Boolean(error)}
					aria-describedby={error ? errorId : helperText ? helperId : undefined}
					className={cn(
						"w-full rounded-md border bg-zinc-900/70 px-3 py-2 text-sm text-white outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 placeholder:text-zinc-500",
						error
							? "border-red-500/60"
							: "border-zinc-700 focus-visible:border-blue-500",
						className,
					)}
					{...props}
				/>
				{error ? (
					<p id={errorId} className="text-sm text-red-400">
						{error}
					</p>
				) : helperText ? (
					<p id={helperId} className="text-sm text-zinc-400">
						{helperText}
					</p>
				) : null}
			</div>
		);
	},
);

Input.displayName = "Input";

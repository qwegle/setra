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
						className="text-sm font-medium text-[#2b2418]"
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
						"w-full rounded-md border bg-white px-3 py-2 text-sm text-[#2b2418] outline-none transition placeholder:text-[#a89a7a] focus-visible:border-[#7a5421] focus-visible:ring-2 focus-visible:ring-[#e2c787]/60",
						error
							? "border-[#d97c6e]"
							: "border-[#d9c6a3]",
						className,
					)}
					{...props}
				/>
				{error ? (
					<p id={errorId} className="text-sm text-[#8e2f23]">
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

Input.displayName = "Input";

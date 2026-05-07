import { Eye, EyeOff, Plus, X } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/utils";

export interface EnvVar {
	key: string;
	value: string;
}

interface Props {
	vars: EnvVar[];
	onChange: (vars: EnvVar[]) => void;
	readOnly?: boolean;
}

export function EnvVarEditor({ vars, onChange, readOnly }: Props) {
	const [revealedIndices, setRevealedIndices] = useState<Set<number>>(
		new Set(),
	);

	function toggleReveal(index: number) {
		setRevealedIndices((prev) => {
			const next = new Set(prev);
			next.has(index) ? next.delete(index) : next.add(index);
			return next;
		});
	}

	function updateKey(index: number, key: string) {
		const next = vars.map((v, i) => (i === index ? { ...v, key } : v));
		onChange(next);
	}

	function updateValue(index: number, value: string) {
		const next = vars.map((v, i) => (i === index ? { ...v, value } : v));
		onChange(next);
	}

	function remove(index: number) {
		onChange(vars.filter((_, i) => i !== index));
	}

	function add() {
		onChange([...vars, { key: "", value: "" }]);
	}

	return (
		<div className="space-y-1.5">
			{vars.length > 0 && (
				<div className="rounded-lg border border-border/50 overflow-hidden divide-y divide-border/30">
					{vars.map((v, i) => (
						<div
							key={`${v.key}-${v.value}`}
							className="flex items-center gap-0"
						>
							<input
								type="text"
								value={v.key}
								onChange={(e) => updateKey(i, e.target.value)}
								readOnly={readOnly}
								placeholder="KEY"
								className={cn(
									"flex-1 px-3 py-2 bg-transparent text-xs font-mono text-foreground placeholder:text-muted-foreground/40",
									"focus:outline-none focus:bg-setra-600/5",
									"border-r border-border/30",
									readOnly && "cursor-default",
								)}
							/>
							<div className="flex-1 flex items-center border-r border-border/30">
								<input
									type={revealedIndices.has(i) ? "text" : "password"}
									value={v.value}
									onChange={(e) => updateValue(i, e.target.value)}
									readOnly={readOnly}
									placeholder="value"
									className={cn(
										"flex-1 px-3 py-2 bg-transparent text-xs font-mono text-foreground placeholder:text-muted-foreground/40",
										"focus:outline-none focus:bg-setra-600/5 min-w-0",
										readOnly && "cursor-default",
									)}
								/>
								<button
									type="button"
									onClick={() => toggleReveal(i)}
									className="px-2 py-2 text-muted-foreground/50 hover:text-muted-foreground transition-colors flex-shrink-0"
								>
									{revealedIndices.has(i) ? (
										<EyeOff className="w-3.5 h-3.5" />
									) : (
										<Eye className="w-3.5 h-3.5" />
									)}
								</button>
							</div>
							{!readOnly && (
								<button
									type="button"
									onClick={() => remove(i)}
									className="px-3 py-2 text-muted-foreground/40 hover:text-accent-red transition-colors flex-shrink-0"
								>
									<X className="w-3.5 h-3.5" />
								</button>
							)}
						</div>
					))}
				</div>
			)}

			{!readOnly && (
				<button
					type="button"
					onClick={add}
					className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-setra-300 hover:bg-setra-600/10 rounded-md transition-colors"
				>
					<Plus className="w-3.5 h-3.5" />
					Add variable
				</button>
			)}

			{vars.length === 0 && readOnly && (
				<p className="text-xs text-muted-foreground/50 italic">
					No environment variables
				</p>
			)}
		</div>
	);
}

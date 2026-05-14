import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
	error: Error | null;
	componentStack: string;
}

export class ErrorBoundary extends Component<Props, State> {
	override state: State = { error: null, componentStack: "" };

	static getDerivedStateFromError(error: Error): State {
		return { error, componentStack: "" };
	}

	override componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("[ErrorBoundary]", error, info.componentStack);
		this.setState({ componentStack: info.componentStack ?? "" });
	}

	reset = () => this.setState({ error: null, componentStack: "" });

	override render() {
		const { error, componentStack } = this.state;
		if (!error) return this.props.children;
		if (this.props.fallback) return this.props.fallback(error, this.reset);

		return (
			<div className="min-h-[60vh] flex items-center justify-center p-6 bg-background text-foreground">
				<div className="max-w-xl w-full glass rounded-2xl p-6 space-y-5 border border-border/40">
					<div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-red/10 text-accent-red">
						<AlertTriangle className="h-7 w-7" />
					</div>
					<div className="space-y-2 text-center">
						<h1 className="text-lg font-semibold">Something went wrong</h1>
						<p className="text-sm text-muted-foreground">
							Try refreshing the page. Your work should still be here.
						</p>
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={this.reset}
							className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-setra-600 px-4 py-2 text-sm font-medium text-[#2b2418] transition-colors hover:bg-setra-500"
						>
							<RotateCcw className="h-4 w-4" />
							Try again
						</button>
						<button
							type="button"
							onClick={() => window.location.reload()}
							className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border/50 px-4 py-2 text-sm transition-colors hover:border-border"
						>
							<RefreshCw className="h-4 w-4" />
							Refresh page
						</button>
					</div>
					<details className="rounded-xl border border-border/40 bg-muted/20 p-3 text-left">
						<summary className="cursor-pointer text-sm font-medium text-foreground">
							Technical details
						</summary>
						<pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-background/60 p-3 text-xs text-muted-foreground">
							{error.message}
							{error.stack ? `\n\n${error.stack}` : ""}
							{componentStack ? `\n\n${componentStack}` : ""}
						</pre>
					</details>
				</div>
			</div>
		);
	}
}

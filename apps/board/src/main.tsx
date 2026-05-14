import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "./context/AuthContext";
import { bootstrapTheme } from "./lib/theme";
import "./index.css";

bootstrapTheme();

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 15_000,
			retry: 1,
			refetchOnWindowFocus: false,
			refetchIntervalInBackground: false,
		},
	},
});

// Surface unhandled errors so they reach the renderer console (and Setra main log).
window.addEventListener("error", (e) => {
	console.error("[window.error]", e.message, e.filename, e.lineno, e.error);
});
window.addEventListener("unhandledrejection", (e) => {
	console.error("[unhandledrejection]", e.reason);
});

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<ErrorBoundary>
			<BrowserRouter>
				<QueryClientProvider client={queryClient}>
					<AuthProvider>
						<App />
					</AuthProvider>
				</QueryClientProvider>
			</BrowserRouter>
		</ErrorBoundary>
	</StrictMode>,
);

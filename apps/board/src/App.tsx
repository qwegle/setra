import {
	Navigate,
	Outlet,
	Route,
	Routes,
	useLocation,
	useParams,
} from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { useAuth } from "./context/AuthContext";
import { ActivityPage } from "./pages/ActivityPage";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { AgentsPage } from "./pages/AgentsPage";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { ClonePage } from "./pages/ClonePage";
import { CollaborationPage } from "./pages/CollaborationPage";
import { CompanySettingsPage } from "./pages/CompanySettingsPage";
import { CostsPage } from "./pages/CostsPage";
import { EnvironmentsPage } from "./pages/EnvironmentsPage";
import { FilesPage } from "./pages/FilesPage";
import { GoalsPage } from "./pages/GoalsPage";
import { HealthPage } from "./pages/HealthPage";
import { InboxPage } from "./pages/InboxPage";
import { InstanceSettingsPage } from "./pages/InstanceSettingsPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { IssueDetailPage } from "./pages/IssueDetailPage";
import { IssuesPage } from "./pages/IssuesPage";
import { LoginPage } from "./pages/LoginPage";
import { McpPage } from "./pages/McpPage";
import { MultiViewPage } from "./pages/MultiViewPage";
import { OrgPage } from "./pages/OrgUnifiedPage";
import { OverviewPage } from "./pages/OverviewPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RoutinesPage } from "./pages/RoutinesPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SkillsPage } from "./pages/SkillsPage";

function AgentRedirect() {
	const { agentId } = useParams<{ agentId: string }>();
	return <Navigate to={`/agents/${agentId}/dashboard`} replace />;
}

function RequireAuth() {
	const { isAuthenticated, isLoading } = useAuth();
	const location = useLocation();

	if (isLoading) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-ground-900 text-sm text-muted-foreground">
				Checking session…
			</div>
		);
	}

	if (!isAuthenticated) {
		return <Navigate to="/login" replace state={{ from: location }} />;
	}

	return <Outlet />;
}

export default function App() {
	return (
		<Routes>
			<Route path="/login" element={<LoginPage />} />
			<Route element={<RequireAuth />}>
				<Route element={<AppShell />}>
					<Route index element={<Navigate to="/overview" replace />} />
					<Route path="/overview" element={<OverviewPage />} />
					<Route path="/projects" element={<ProjectsPage />} />
					<Route path="/projects/:id" element={<ProjectDetailPage />} />
					<Route path="/issues/:issueId" element={<IssueDetailPage />} />
					<Route path="/agents" element={<AgentsPage />} />
					<Route path="/agents/:agentId" element={<AgentRedirect />} />
					<Route path="/agents/:agentId/:tab" element={<AgentDetailPage />} />
					<Route path="/integrations" element={<IntegrationsPage />} />
					<Route path="/mcp" element={<McpPage />} />
					<Route path="/skills" element={<SkillsPage />} />
					<Route path="/settings" element={<SettingsPage />} />
					<Route path="/inbox" element={<InboxPage />} />
					<Route path="/approvals" element={<ApprovalsPage />} />
					<Route path="/goals" element={<GoalsPage />} />
					<Route path="/activity" element={<ActivityPage />} />
					<Route path="/routines" element={<RoutinesPage />} />
					<Route path="/costs" element={<CostsPage />} />
					<Route path="/health" element={<HealthPage />} />
					<Route path="/settings/company" element={<CompanySettingsPage />} />
					<Route path="/settings/instance" element={<InstanceSettingsPage />} />
					<Route path="/profile" element={<ProfilePage />} />
					<Route path="/environments" element={<EnvironmentsPage />} />
					<Route
						path="/workspaces"
						element={<Navigate to="/environments" replace />}
					/>
					<Route
						path="/org-chart"
						element={<Navigate to="/org?tab=chart" replace />}
					/>
					<Route
						path="/organization"
						element={<Navigate to="/org?tab=agents" replace />}
					/>
					<Route path="/org" element={<OrgPage />} />
					<Route path="/search" element={<SearchPage />} />
					<Route path="/files" element={<FilesPage />} />

					{/* Legacy redirects for trimmed routes */}
					<Route path="/onboarding" element={<OverviewPage />} />
					<Route path="/collaboration" element={<CollaborationPage />} />
					<Route path="/multi-view" element={<MultiViewPage />} />
					<Route path="/clone" element={<ClonePage />} />
					<Route
						path="/llm-manager"
						element={<Navigate to="/settings" replace />}
					/>
					<Route
						path="/adapters"
						element={<Navigate to="/settings" replace />}
					/>
					<Route path="/artifacts" element={<Navigate to="/inbox" replace />} />
					<Route path="/wiki" element={<Navigate to="/inbox" replace />} />
					<Route
						path="/review"
						element={<Navigate to="/approvals" replace />}
					/>
					<Route
						path="*"
						element={
							<div className="flex h-full items-center justify-center text-zinc-400">
								<div className="text-center">
									<h1 className="mb-2 text-4xl font-bold">404</h1>
									<p>Page not found</p>
									<a
										href="/"
										className="mt-4 inline-block text-blue-400 hover:underline"
									>
										Go home
									</a>
								</div>
							</div>
						}
					/>
				</Route>
			</Route>
		</Routes>
	);
}

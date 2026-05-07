package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/qwegle/setra/pkg/client"
	"github.com/qwegle/setra/pkg/config"
	"github.com/qwegle/setra/pkg/types"
)

var (
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#0ea5e9")).
			PaddingLeft(1)

	activeTabStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#0ea5e9")).
			Background(lipgloss.Color("#1e293b")).
			Padding(0, 2)

	inactiveTabStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("#64748b")).
				Padding(0, 2)

	contentStyle = lipgloss.NewStyle().
			PaddingLeft(2).
			PaddingTop(1)

	statusBarStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#94a3b8")).
			Background(lipgloss.Color("#0f172a")).
			PaddingLeft(1)

	headerStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#e2e8f0")).
			PaddingBottom(1)

	dimStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#64748b"))

	greenDot = lipgloss.NewStyle().Foreground(lipgloss.Color("#22c55e")).Render("●")
	blueDot  = lipgloss.NewStyle().Foreground(lipgloss.Color("#0ea5e9")).Render("○")
	redDot   = lipgloss.NewStyle().Foreground(lipgloss.Color("#ef4444")).Render("●")
)

type tab int

const (
	tabDashboard tab = iota
	tabAgents
	tabRuns
	tabProjects
	tabCosts
	tabSettings
)

func (t tab) String() string {
	switch t {
	case tabDashboard:
		return "Dashboard"
	case tabAgents:
		return "Agents"
	case tabRuns:
		return "Runs"
	case tabProjects:
		return "Projects"
	case tabCosts:
		return "Costs"
	case tabSettings:
		return "Settings"
	default:
		return "?"
	}
}

// Messages for async data fetching
type dataMsg struct {
	health   *types.HealthStatus
	agents   []types.Agent
	projects []types.Project
	runs     []types.Run
	costs    *types.CostSummary
	cfg      *config.Config
	err      error
}

type tickMsg time.Time

type model struct {
	activeTab tab
	tabs      []tab
	width     int
	height    int
	quitting  bool

	// Live data
	client   *client.Client
	cfg      *config.Config
	health   *types.HealthStatus
	agents   []types.Agent
	projects []types.Project
	runs     []types.Run
	costs    *types.CostSummary
	lastErr  string
	loading  bool
}

func initialModel() model {
	cfg, _ := config.Load()
	c := client.New(cfg)

	return model{
		activeTab: tabDashboard,
		tabs: []tab{
			tabDashboard, tabAgents, tabRuns,
			tabProjects, tabCosts, tabSettings,
		},
		client:  c,
		cfg:     cfg,
		loading: true,
	}
}

func fetchData(c *client.Client, cfg *config.Config) tea.Cmd {
	return func() tea.Msg {
		d := dataMsg{cfg: cfg}

		health, err := c.Health()
		if err != nil {
			d.err = err
			return d
		}
		d.health = health

		agents, _ := c.ListAgents()
		d.agents = agents

		projects, _ := c.ListProjects()
		d.projects = projects

		runs, _ := c.ListRuns("")
		d.runs = runs

		costs, _ := c.GetCosts()
		d.costs = costs

		return d
	}
}

func tickCmd() tea.Cmd {
	return tea.Tick(5*time.Second, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

func (m model) Init() tea.Cmd {
	return tea.Batch(fetchData(m.client, m.cfg), tickCmd())
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			m.quitting = true
			return m, tea.Quit
		case "tab", "right", "l":
			idx := int(m.activeTab)
			idx = (idx + 1) % len(m.tabs)
			m.activeTab = m.tabs[idx]
		case "shift+tab", "left", "h":
			idx := int(m.activeTab)
			idx = (idx - 1 + len(m.tabs)) % len(m.tabs)
			m.activeTab = m.tabs[idx]
		case "1":
			m.activeTab = tabDashboard
		case "2":
			m.activeTab = tabAgents
		case "3":
			m.activeTab = tabRuns
		case "4":
			m.activeTab = tabProjects
		case "5":
			m.activeTab = tabCosts
		case "6":
			m.activeTab = tabSettings
		case "r":
			m.loading = true
			return m, fetchData(m.client, m.cfg)
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

	case dataMsg:
		m.loading = false
		if msg.err != nil {
			m.lastErr = msg.err.Error()
		} else {
			m.lastErr = ""
			m.health = msg.health
			m.agents = msg.agents
			m.projects = msg.projects
			m.runs = msg.runs
			m.costs = msg.costs
			m.cfg = msg.cfg
		}

	case tickMsg:
		return m, tea.Batch(fetchData(m.client, m.cfg), tickCmd())
	}
	return m, nil
}

func (m model) View() string {
	if m.quitting {
		return ""
	}

	header := titleStyle.Render("⚡ Setra")

	var tabs string
	for _, t := range m.tabs {
		if t == m.activeTab {
			tabs += activeTabStyle.Render(t.String())
		} else {
			tabs += inactiveTabStyle.Render(t.String())
		}
	}

	var content string
	switch m.activeTab {
	case tabDashboard:
		content = m.dashboardView()
	case tabAgents:
		content = m.agentsView()
	case tabRuns:
		content = m.runsView()
	case tabProjects:
		content = m.projectsView()
	case tabCosts:
		content = m.costsView()
	case tabSettings:
		content = m.settingsView()
	}

	loadingIndicator := ""
	if m.loading {
		loadingIndicator = " ⟳"
	}

	status := statusBarStyle.Width(m.width).Render(
		fmt.Sprintf("Tab/←→ Navigate  •  1-6 Jump  •  r Refresh  •  q Quit%s", loadingIndicator),
	)

	return fmt.Sprintf("%s\n%s\n\n%s\n\n%s",
		header, tabs, contentStyle.Render(content), status)
}

func (m model) dashboardView() string {
	if m.lastErr != "" {
		return headerStyle.Render("Dashboard") + "\n" +
			"  Server       " + redDot + " offline\n\n" +
			dimStyle.Render("  Error: "+m.lastErr) + "\n" +
			dimStyle.Render("  Start server: setra start --web")
	}

	serverStatus := greenDot + " online"
	version := ""
	activeRuns := 0
	if m.health != nil {
		version = fmt.Sprintf("  (v%s)", m.health.Version)
		activeRuns = m.health.ActiveRun
	}

	agentCount := len(m.agents)
	runningAgents := 0
	for _, a := range m.agents {
		if a.Status == types.AgentStatusRunning {
			runningAgents++
		}
	}

	todayCost := 0.0
	if m.costs != nil {
		todayCost = m.costs.TodayUSD
	}

	return headerStyle.Render("Dashboard") + "\n" +
		fmt.Sprintf("  Server       %s%s\n", serverStatus, version) +
		fmt.Sprintf("  Agents       %d total, %d running\n", agentCount, runningAgents) +
		fmt.Sprintf("  Active Runs  %d\n", activeRuns) +
		fmt.Sprintf("  Projects     %d\n", len(m.projects)) +
		fmt.Sprintf("  Today Cost   $%.2f\n", todayCost)
}

func (m model) agentsView() string {
	s := headerStyle.Render("Agent Roster") + "\n"

	if len(m.agents) == 0 {
		return s + dimStyle.Render("  No agents configured. Add agents in the web dashboard.")
	}

	s += fmt.Sprintf("  %-14s %-10s %-22s %-8s %s\n",
		"NAME", "ROLE", "MODEL", "RUNS", "STATUS")
	s += fmt.Sprintf("  %-14s %-10s %-22s %-8s %s\n",
		"──────────────", "──────────", "──────────────────────", "────────", "──────")

	for _, a := range m.agents {
		dot := blueDot
		status := string(a.Status)
		switch a.Status {
		case types.AgentStatusRunning:
			dot = greenDot
		case types.AgentStatusError:
			dot = redDot
		}

		name := truncate(a.Name, 14)
		role := truncate(a.Role, 10)
		model := truncate(a.Model, 22)

		s += fmt.Sprintf("  %-14s %-10s %-22s %-8d %s %s\n",
			name, role, model, a.TotalRuns, dot, status)
	}

	return s
}

func (m model) runsView() string {
	s := headerStyle.Render("Recent Runs") + "\n"

	if len(m.runs) == 0 {
		return s + dimStyle.Render("  No runs yet. Dispatch an agent to start.")
	}

	s += fmt.Sprintf("  %-10s %-12s %-10s %-10s %s\n",
		"ID", "STATUS", "MODEL", "COST", "STARTED")
	s += fmt.Sprintf("  %-10s %-12s %-10s %-10s %s\n",
		"──────────", "────────────", "──────────", "──────────", "───────")

	limit := len(m.runs)
	if limit > 20 {
		limit = 20
	}
	for _, r := range m.runs[:limit] {
		id := truncate(r.ID, 10)
		model := truncate(r.Model, 10)
		started := r.StartedAt.Format("15:04:05")

		s += fmt.Sprintf("  %-10s %-12s %-10s $%-9.2f %s\n",
			id, r.Status, model, r.CostUSD, started)
	}

	if len(m.runs) > 20 {
		s += dimStyle.Render(fmt.Sprintf("\n  ... and %d more runs", len(m.runs)-20))
	}

	return s
}

func (m model) projectsView() string {
	s := headerStyle.Render("Projects") + "\n"

	if len(m.projects) == 0 {
		return s + dimStyle.Render("  No projects. Create one in the web dashboard.")
	}

	for _, p := range m.projects {
		name := truncate(p.Name, 30)
		desc := truncate(p.Description, 50)
		s += fmt.Sprintf("  • %-30s %s\n", name, dimStyle.Render(desc))
	}

	return s
}

func (m model) costsView() string {
	s := headerStyle.Render("Cost Ledger") + "\n"

	if m.costs == nil {
		return s + dimStyle.Render("  No cost data available.")
	}

	budgetPct := 0.0
	if m.costs.BudgetCapUSD > 0 {
		budgetPct = (m.costs.TotalUSD / m.costs.BudgetCapUSD) * 100
	}

	s += fmt.Sprintf("  Total Spend     $%.2f\n", m.costs.TotalUSD)
	s += fmt.Sprintf("  Today           $%.2f\n", m.costs.TodayUSD)
	s += fmt.Sprintf("  Budget Cap      $%.2f\n", m.costs.BudgetCapUSD)
	s += fmt.Sprintf("  Usage           %.1f%%\n", budgetPct)
	s += fmt.Sprintf("  Input Tokens    %s\n", formatTokens(m.costs.InputTokens))
	s += fmt.Sprintf("  Output Tokens   %s\n", formatTokens(m.costs.OutputTokens))

	return s
}

func (m model) settingsView() string {
	serverURL := "http://localhost:3141"
	companyID := "(not set)"
	theme := "dark"

	if m.cfg != nil {
		if m.cfg.ServerURL != "" {
			serverURL = m.cfg.ServerURL
		}
		if m.cfg.CompanyID != "" {
			companyID = m.cfg.CompanyID
		}
		if m.cfg.Theme != "" {
			theme = m.cfg.Theme
		}
	}

	connected := redDot + " disconnected"
	if m.lastErr == "" && m.health != nil {
		connected = greenDot + " connected"
	}

	return headerStyle.Render("Settings") + "\n" +
		fmt.Sprintf("  Server URL      %s\n", serverURL) +
		fmt.Sprintf("  Connection      %s\n", connected) +
		fmt.Sprintf("  Company         %s\n", companyID) +
		fmt.Sprintf("  Theme           %s\n\n", theme) +
		dimStyle.Render("  Edit ~/.setra/cli-config.json to change settings.")
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-1] + "…"
}

func formatTokens(n int64) string {
	if n >= 1_000_000 {
		return fmt.Sprintf("%.1fM", float64(n)/1_000_000)
	}
	if n >= 1_000 {
		return fmt.Sprintf("%.1fK", float64(n)/1_000)
	}
	return fmt.Sprintf("%d", n)
}

func padRight(s string, w int) string {
	if len(s) >= w {
		return s[:w]
	}
	return s + strings.Repeat(" ", w-len(s))
}

func main() {
	p := tea.NewProgram(initialModel(), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

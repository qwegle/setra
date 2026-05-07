package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
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

	sidebarStyle = lipgloss.NewStyle().
			Width(24).
			BorderRight(true).
			BorderStyle(lipgloss.NormalBorder()).
			BorderForeground(lipgloss.Color("#334155")).
			PaddingRight(1).
			PaddingLeft(1)

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

type model struct {
	activeTab tab
	tabs      []tab
	width     int
	height    int
	quitting  bool
}

func initialModel() model {
	return model{
		activeTab: tabDashboard,
		tabs: []tab{
			tabDashboard, tabAgents, tabRuns,
			tabProjects, tabCosts, tabSettings,
		},
	}
}

func (m model) Init() tea.Cmd {
	return nil
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
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

func (m model) View() string {
	if m.quitting {
		return ""
	}

	// Header
	header := titleStyle.Render("⚡ Setra")

	// Tab bar
	var tabs string
	for _, t := range m.tabs {
		if t == m.activeTab {
			tabs += activeTabStyle.Render(t.String())
		} else {
			tabs += inactiveTabStyle.Render(t.String())
		}
	}

	// Content
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

	// Status bar
	status := statusBarStyle.Width(m.width).Render(
		fmt.Sprintf("Tab/←→ Navigate  •  1-6 Jump  •  q Quit  •  %s", m.activeTab),
	)

	return fmt.Sprintf("%s\n%s\n\n%s\n\n%s",
		header, tabs, contentStyle.Render(content), status)
}

func (m model) dashboardView() string {
	return headerStyle.Render("Dashboard") + "\n" +
		"  Server       " + lipgloss.NewStyle().Foreground(lipgloss.Color("#22c55e")).Render("● online") + "\n" +
		"  Agents       3 total, 1 running\n" +
		"  Active Runs  2\n" +
		"  Today Cost   $0.42\n\n" +
		dimStyle.Render("  Connect to server for live data: setra start --web")
}

func (m model) agentsView() string {
	return headerStyle.Render("Agent Roster") + "\n" +
		"  NAME    ROLE      MODEL             STATUS\n" +
		"  ────    ────      ─────             ──────\n" +
		"  CEO     planner   claude-sonnet-4   " + lipgloss.NewStyle().Foreground(lipgloss.Color("#22c55e")).Render("● running") + "\n" +
		"  Dev-1   coder     gemini-2.5-pro    " + lipgloss.NewStyle().Foreground(lipgloss.Color("#0ea5e9")).Render("○ idle") + "\n" +
		"  QA      tester    codex-o4-mini     " + lipgloss.NewStyle().Foreground(lipgloss.Color("#0ea5e9")).Render("○ idle") + "\n\n" +
		dimStyle.Render("  h Hire  •  d Dispatch  •  s Stop  •  Enter Details")
}

func (m model) runsView() string {
	return headerStyle.Render("Recent Runs") + "\n" +
		dimStyle.Render("  No active runs. Dispatch an agent to start.")
}

func (m model) projectsView() string {
	return headerStyle.Render("Projects") + "\n" +
		dimStyle.Render("  No projects. Press 'n' to create one.")
}

func (m model) costsView() string {
	return headerStyle.Render("Cost Ledger") + "\n" +
		"  Total Spend     $0.00\n" +
		"  Budget Cap      $50.00\n" +
		"  Usage           0%\n\n" +
		dimStyle.Render("  Connect to server for live cost data.")
}

func (m model) settingsView() string {
	return headerStyle.Render("Settings") + "\n" +
		"  Server URL      http://localhost:3141\n" +
		"  Company         (not set)\n" +
		"  Theme           dark\n\n" +
		dimStyle.Render("  Press Enter to edit a setting.")
}

func main() {
	p := tea.NewProgram(initialModel(), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

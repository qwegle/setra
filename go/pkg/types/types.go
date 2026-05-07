// Package types defines shared data structures for the setra platform.
package types

import "time"

type AgentStatus string

const (
	AgentStatusIdle    AgentStatus = "idle"
	AgentStatusRunning AgentStatus = "running"
	AgentStatusError   AgentStatus = "error"
	AgentStatusStopped AgentStatus = "stopped"
)

type Project struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	RepoURL     string    `json:"repoUrl"`
	Branch      string    `json:"branch"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type Agent struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Role        string      `json:"role"`
	Status      AgentStatus `json:"status"`
	Model       string      `json:"model"`
	Adapter     string      `json:"adapter"`
	IsActive    bool        `json:"isActive"`
	TotalRuns   int         `json:"totalRuns"`
	TotalCost   float64     `json:"totalCostUsd"`
	CreatedAt   time.Time   `json:"createdAt"`
}

type Run struct {
	ID        string    `json:"id"`
	AgentID   string    `json:"agentId"`
	ProjectID string    `json:"projectId"`
	Status    string    `json:"status"`
	Model     string    `json:"model"`
	CostUSD   float64   `json:"costUsd"`
	Tokens    int64     `json:"tokens"`
	StartedAt time.Time `json:"startedAt"`
	EndedAt   time.Time `json:"endedAt,omitempty"`
}

type Issue struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Priority    string `json:"priority"`
	ProjectID   string `json:"projectId"`
	AssigneeID  string `json:"assigneeId,omitempty"`
}

type Company struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

type HealthStatus struct {
	Status    string  `json:"status"`
	Uptime    float64 `json:"uptime"`
	Version   string  `json:"version"`
	ActiveRun int     `json:"activeRuns"`
}

type Model struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Provider string `json:"provider"`
	IsLocal  bool   `json:"isLocal"`
}

type CostSummary struct {
	TotalUSD      float64 `json:"totalUsd"`
	TodayUSD      float64 `json:"todayUsd"`
	BudgetCapUSD  float64 `json:"budgetCapUsd"`
	InputTokens   int64   `json:"inputTokens"`
	OutputTokens  int64   `json:"outputTokens"`
}

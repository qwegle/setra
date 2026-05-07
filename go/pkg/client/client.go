// Package client provides a typed HTTP client for the setra server API.
package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/qwegle/setra/pkg/config"
	"github.com/qwegle/setra/pkg/types"
)

type Client struct {
	baseURL    string
	authToken  string
	companyID  string
	httpClient *http.Client
}

func New(cfg *config.Config) *Client {
	return &Client{
		baseURL:   cfg.ServerURL,
		authToken: cfg.AuthToken,
		companyID: cfg.CompanyID,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *Client) do(method, path string, body any, result any) error {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	url := fmt.Sprintf("%s%s", c.baseURL, path)
	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.authToken)
	}
	if c.companyID != "" {
		req.Header.Set("X-Company-ID", c.companyID)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error %d: %s", resp.StatusCode, string(respBody))
	}

	if result != nil {
		if err := json.NewDecoder(resp.Body).Decode(result); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}
	return nil
}

func (c *Client) Health() (*types.HealthStatus, error) {
	var h types.HealthStatus
	return &h, c.do("GET", "/api/health", nil, &h)
}

func (c *Client) ListProjects() ([]types.Project, error) {
	var projects []types.Project
	return projects, c.do("GET", "/api/projects", nil, &projects)
}

func (c *Client) GetProject(id string) (*types.Project, error) {
	var p types.Project
	return &p, c.do("GET", "/api/projects/"+id, nil, &p)
}

func (c *Client) ListAgents() ([]types.Agent, error) {
	var agents []types.Agent
	return agents, c.do("GET", "/api/agents/roster", nil, &agents)
}

func (c *Client) ListRuns(projectID string) ([]types.Run, error) {
	var runs []types.Run
	path := "/api/agents/runs"
	if projectID != "" {
		path += "?projectId=" + projectID
	}
	return runs, c.do("GET", path, nil, &runs)
}

func (c *Client) ListIssues(projectID string) ([]types.Issue, error) {
	var issues []types.Issue
	path := "/api/issues"
	if projectID != "" {
		path += "?projectId=" + projectID
	}
	return issues, c.do("GET", path, nil, &issues)
}

func (c *Client) ListModels() ([]types.Model, error) {
	var models []types.Model
	return models, c.do("GET", "/api/models", nil, &models)
}

func (c *Client) GetCosts() (*types.CostSummary, error) {
	var costs types.CostSummary
	return &costs, c.do("GET", "/api/costs/summary", nil, &costs)
}

func (c *Client) ListCompanies() ([]types.Company, error) {
	var companies []types.Company
	return companies, c.do("GET", "/api/companies", nil, &companies)
}

func (c *Client) DispatchAgent(agentID, issueID string) error {
	body := map[string]string{"agentId": agentID, "issueId": issueID}
	return c.do("POST", "/api/agents/dispatch", body, nil)
}

func (c *Client) StopRun(runID string) error {
	return c.do("POST", "/api/agents/runs/"+runID+"/stop", nil, nil)
}

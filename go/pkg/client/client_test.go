package client

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/qwegle/setra/pkg/config"
	"github.com/qwegle/setra/pkg/types"
)

func newTestServer(handler http.HandlerFunc) (*httptest.Server, *Client) {
	srv := httptest.NewServer(handler)
	cfg := &config.Config{
		ServerURL: srv.URL,
		AuthToken: "test-token",
		CompanyID: "test-company",
	}
	return srv, New(cfg)
}

func TestHealth(t *testing.T) {
	srv, c := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/health" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("missing auth header")
		}
		json.NewEncoder(w).Encode(types.HealthStatus{
			Status:  "ok",
			Version: "1.0.0",
			Uptime:  3600.0,
		})
	})
	defer srv.Close()

	h, err := c.Health()
	if err != nil {
		t.Fatalf("Health() error: %v", err)
	}
	if h.Status != "ok" {
		t.Errorf("Status = %q, want ok", h.Status)
	}
	if h.Version != "1.0.0" {
		t.Errorf("Version = %q, want 1.0.0", h.Version)
	}
}

func TestListProjects(t *testing.T) {
	srv, c := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/projects" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("X-Company-ID") != "test-company" {
			t.Error("missing company header")
		}
		json.NewEncoder(w).Encode([]types.Project{
			{ID: "p1", Name: "Project One"},
			{ID: "p2", Name: "Project Two"},
		})
	})
	defer srv.Close()

	projects, err := c.ListProjects()
	if err != nil {
		t.Fatalf("ListProjects() error: %v", err)
	}
	if len(projects) != 2 {
		t.Fatalf("got %d projects, want 2", len(projects))
	}
	if projects[0].Name != "Project One" {
		t.Errorf("projects[0].Name = %q, want Project One", projects[0].Name)
	}
}

func TestListAgents(t *testing.T) {
	srv, c := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]types.Agent{
			{ID: "a1", Name: "CEO", Role: "ceo", Status: "idle"},
		})
	})
	defer srv.Close()

	agents, err := c.ListAgents()
	if err != nil {
		t.Fatalf("ListAgents() error: %v", err)
	}
	if len(agents) != 1 {
		t.Fatalf("got %d agents, want 1", len(agents))
	}
	if agents[0].Role != "ceo" {
		t.Errorf("agents[0].Role = %q, want ceo", agents[0].Role)
	}
}

func TestGetCosts(t *testing.T) {
	srv, c := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(types.CostSummary{
			TotalUSD:    12.50,
			TodayUSD:    1.25,
			BudgetCapUSD: 100.0,
		})
	})
	defer srv.Close()

	costs, err := c.GetCosts()
	if err != nil {
		t.Fatalf("GetCosts() error: %v", err)
	}
	if costs.TotalUSD != 12.50 {
		t.Errorf("TotalUSD = %f, want 12.50", costs.TotalUSD)
	}
}

func TestErrorResponse(t *testing.T) {
	srv, c := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("server error"))
	})
	defer srv.Close()

	_, err := c.Health()
	if err == nil {
		t.Fatal("expected error on 500 response")
	}
}

func TestDispatchAgent(t *testing.T) {
	srv, c := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/api/agents/dispatch" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "dispatched"})
	})
	defer srv.Close()

	err := c.DispatchAgent("agent-1", "issue-1")
	if err != nil {
		t.Fatalf("DispatchAgent() error: %v", err)
	}
}

func TestStopRun(t *testing.T) {
	srv, c := newTestServer(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		w.WriteHeader(http.StatusOK)
	})
	defer srv.Close()

	err := c.StopRun("run-123")
	if err != nil {
		t.Fatalf("StopRun() error: %v", err)
	}
}

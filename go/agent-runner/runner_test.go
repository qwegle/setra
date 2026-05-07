package runner

import (
	"context"
	"testing"
	"time"
)

type mockAdapter struct{}

func (m *mockAdapter) Name() string                              { return "mock" }
func (m *mockAdapter) DisplayName() string                       { return "Mock Adapter" }
func (m *mockAdapter) IsAvailable() bool                         { return true }
func (m *mockAdapter) DefaultModel() string                      { return "mock-model" }
func (m *mockAdapter) SupportedModels() []string                 { return []string{"mock-model"} }
func (m *mockAdapter) BuildCommand(opts BuildCommandInput) SpawnOptions {
	return SpawnOptions{
		Command: "echo",
		Args:    []string{"hello from mock"},
		WorkDir: opts.WorkDir,
		Timeout: 5 * time.Second,
	}
}
func (m *mockAdapter) ParseTokenUsage(output string) (int64, int64) { return 100, 50 }
func (m *mockAdapter) ParseCostUSD(output string) float64           { return 0.01 }
func (m *mockAdapter) DetectCompletion(output string) bool          { return true }
func (m *mockAdapter) DetectRateLimit(output string) bool           { return false }

func TestNewRunner(t *testing.T) {
	r := New()
	if r == nil {
		t.Fatal("New() returned nil")
	}
	if r.ActiveRuns() != 0 {
		t.Errorf("ActiveRuns = %d, want 0", r.ActiveRuns())
	}
}

func TestRegisterAndGetAdapter(t *testing.T) {
	r := New()
	mock := &mockAdapter{}
	r.RegisterAdapter(mock)

	got := r.GetAdapter("mock")
	if got == nil {
		t.Fatal("GetAdapter(mock) returned nil")
	}
	if got.Name() != "mock" {
		t.Errorf("adapter name = %q, want mock", got.Name())
	}

	if r.GetAdapter("nonexistent") != nil {
		t.Error("GetAdapter(nonexistent) should return nil")
	}
}

func TestListAdapters(t *testing.T) {
	r := New()
	r.RegisterAdapter(&mockAdapter{})

	adapters := r.ListAdapters()
	if len(adapters) != 1 {
		t.Fatalf("ListAdapters returned %d, want 1", len(adapters))
	}
}

func TestSpawnSimpleCommand(t *testing.T) {
	r := New()
	opts := SpawnOptions{
		Command: "echo",
		Args:    []string{"hello world"},
		Timeout: 5 * time.Second,
	}

	result, err := r.Spawn(context.Background(), "test-run-1", opts)
	if err != nil {
		t.Fatalf("Spawn() error: %v", err)
	}
	if result.ExitCode != 0 {
		t.Errorf("ExitCode = %d, want 0", result.ExitCode)
	}
	if result.Duration <= 0 {
		t.Error("Duration should be > 0")
	}
}

func TestSpawnTimeout(t *testing.T) {
	r := New()
	opts := SpawnOptions{
		Command: "sleep",
		Args:    []string{"10"},
		Timeout: 500 * time.Millisecond,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	result, err := r.Spawn(ctx, "timeout-run", opts)
	// Should either error or return non-zero exit
	if err == nil && result != nil && result.ExitCode == 0 {
		t.Error("expected timeout to cause non-zero exit or error")
	}
}

func TestStopNotFound(t *testing.T) {
	r := New()
	err := r.Stop("nonexistent")
	if err == nil {
		t.Error("Stop(nonexistent) should return error")
	}
}

func TestGetOutputNotFound(t *testing.T) {
	r := New()
	_, err := r.GetOutput("nonexistent")
	if err == nil {
		t.Error("GetOutput(nonexistent) should return error")
	}
}

func TestWriteInputNotFound(t *testing.T) {
	r := New()
	err := r.WriteInput("nonexistent", "test")
	if err == nil {
		t.Error("WriteInput(nonexistent) should return error")
	}
}

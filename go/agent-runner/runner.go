// Package runner provides the core agent execution engine.
// It manages PTY spawning, output parsing, and adapter dispatch.
package runner

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"sync"
	"time"

	"github.com/creack/pty"
)

// SpawnOptions configures how an agent process is spawned.
type SpawnOptions struct {
	Command    string
	Args       []string
	WorkDir    string
	Env        map[string]string
	Timeout    time.Duration
	MaxTokens  int
	SystemFile string
}

// RunResult contains the outcome of an agent run.
type RunResult struct {
	ExitCode     int
	Output       string
	TokensInput  int64
	TokensOutput int64
	CostUSD      float64
	Duration     time.Duration
	Completed    bool
	Error        error
}

// Runner manages agent process execution via PTY.
type Runner struct {
	mu       sync.Mutex
	active   map[string]*runningProcess
	adapters map[string]Adapter
}

type runningProcess struct {
	cmd    *exec.Cmd
	ptmx   *os.File
	cancel context.CancelFunc
	output []byte
	done   chan struct{}
}

// New creates a new Runner instance.
func New() *Runner {
	return &Runner{
		active:   make(map[string]*runningProcess),
		adapters: make(map[string]Adapter),
	}
}

// RegisterAdapter adds an adapter to the runner.
func (r *Runner) RegisterAdapter(a Adapter) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.adapters[a.Name()] = a
}

// GetAdapter returns the named adapter, or nil.
func (r *Runner) GetAdapter(name string) Adapter {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.adapters[name]
}

// ListAdapters returns all registered adapters.
func (r *Runner) ListAdapters() []Adapter {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]Adapter, 0, len(r.adapters))
	for _, a := range r.adapters {
		result = append(result, a)
	}
	return result
}

// Spawn starts an agent process in a PTY and returns the run ID.
func (r *Runner) Spawn(ctx context.Context, runID string, opts SpawnOptions) (*RunResult, error) {
	ctx, cancel := context.WithCancel(ctx)
	if opts.Timeout > 0 {
		ctx, cancel = context.WithTimeout(ctx, opts.Timeout)
	}

	cmd := exec.CommandContext(ctx, opts.Command, opts.Args...)
	cmd.Dir = opts.WorkDir

	// Merge environment
	cmd.Env = os.Environ()
	for k, v := range opts.Env {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	// Start in PTY
	ptmx, err := pty.Start(cmd)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("pty start: %w", err)
	}

	proc := &runningProcess{
		cmd:    cmd,
		ptmx:   ptmx,
		cancel: cancel,
		done:   make(chan struct{}),
	}

	r.mu.Lock()
	r.active[runID] = proc
	r.mu.Unlock()

	// Read output in background
	start := time.Now()
	go func() {
		defer close(proc.done)
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				proc.output = append(proc.output, buf[:n]...)
			}
			if err != nil {
				break
			}
		}
	}()

	// Wait for completion
	err = cmd.Wait()
	<-proc.done
	ptmx.Close()

	r.mu.Lock()
	delete(r.active, runID)
	r.mu.Unlock()

	result := &RunResult{
		Output:    string(proc.output),
		Duration:  time.Since(start),
		Completed: err == nil,
	}

	if cmd.ProcessState != nil {
		result.ExitCode = cmd.ProcessState.ExitCode()
	}
	if err != nil {
		result.Error = err
	}

	return result, nil
}

// Stop terminates a running agent process.
func (r *Runner) Stop(runID string) error {
	r.mu.Lock()
	proc, ok := r.active[runID]
	r.mu.Unlock()

	if !ok {
		return fmt.Errorf("run %s not found", runID)
	}

	proc.cancel()
	return nil
}

// GetOutput returns the current output of a running process.
func (r *Runner) GetOutput(runID string) (string, error) {
	r.mu.Lock()
	proc, ok := r.active[runID]
	r.mu.Unlock()

	if !ok {
		return "", fmt.Errorf("run %s not found", runID)
	}

	return string(proc.output), nil
}

// WriteInput sends input to a running process PTY.
func (r *Runner) WriteInput(runID string, input string) error {
	r.mu.Lock()
	proc, ok := r.active[runID]
	r.mu.Unlock()

	if !ok {
		return fmt.Errorf("run %s not found", runID)
	}

	_, err := io.WriteString(proc.ptmx, input)
	return err
}

// ActiveRuns returns the number of currently running processes.
func (r *Runner) ActiveRuns() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.active)
}

// --- Output Parsing Utilities ---

var (
	costRegex     = regexp.MustCompile(`Total cost:\s*\$([0-9.]+)`)
	inputTokens   = regexp.MustCompile(`Input:\s*([0-9,]+)`)
	outputTokens  = regexp.MustCompile(`Output:\s*([0-9,]+)`)
)

// ParseCost extracts cost from agent output.
func ParseCost(output string) float64 {
	m := costRegex.FindStringSubmatch(output)
	if len(m) < 2 {
		return 0
	}
	var cost float64
	fmt.Sscanf(m[1], "%f", &cost)
	return cost
}

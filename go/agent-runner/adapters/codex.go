package adapters

import (
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	runner "github.com/qwegle/setra/agent-runner"
)

// Codex implements the Adapter interface for OpenAI's Codex CLI.
type Codex struct{}

func (c *Codex) Name() string        { return "codex" }
func (c *Codex) DisplayName() string  { return "OpenAI Codex" }
func (c *Codex) DefaultModel() string { return "o4-mini" }

func (c *Codex) SupportedModels() []string {
	return []string{"o4-mini", "o3", "gpt-4.1"}
}

func (c *Codex) IsAvailable() bool {
	_, err := exec.LookPath("codex")
	return err == nil
}

func (c *Codex) BuildCommand(opts runner.BuildCommandInput) runner.SpawnOptions {
	args := []string{"-q", opts.Task}
	if opts.Model != "" {
		args = append(args, "--model", opts.Model)
	}
	return runner.SpawnOptions{
		Command: "codex",
		Args:    args,
		WorkDir: opts.WorkDir,
	}
}

var (
	codexPromptRegex = regexp.MustCompile(`prompt tokens:\s*([0-9,]+)`)
	codexCompRegex   = regexp.MustCompile(`completion tokens:\s*([0-9,]+)`)
	codexCostRegex   = regexp.MustCompile(`cost:\s*\$([0-9.]+)`)
)

func (c *Codex) ParseTokenUsage(output string) (int64, int64) {
	var inp, out int64
	if m := codexPromptRegex.FindStringSubmatch(output); len(m) >= 2 {
		inp = parseTokenCount(m[1])
	}
	if m := codexCompRegex.FindStringSubmatch(output); len(m) >= 2 {
		out = parseTokenCount(m[1])
	}
	return inp, out
}

func (c *Codex) ParseCostUSD(output string) float64 {
	m := codexCostRegex.FindStringSubmatch(output)
	if len(m) < 2 {
		return 0
	}
	cost, _ := strconv.ParseFloat(m[1], 64)
	return cost
}

func (c *Codex) DetectCompletion(output string) bool {
	return strings.Contains(output, "cost:")
}

func (c *Codex) DetectRateLimit(output string) bool {
	return strings.Contains(output, "rate_limit") || strings.Contains(output, "429")
}

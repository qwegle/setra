package adapters

import (
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	runner "github.com/qwegle/setra/agent-runner"
)

// Claude implements the Adapter interface for Anthropic's Claude CLI.
type Claude struct{}

func (c *Claude) Name() string        { return "claude" }
func (c *Claude) DisplayName() string  { return "Claude Code" }
func (c *Claude) DefaultModel() string { return "claude-sonnet-4-20250514" }

func (c *Claude) SupportedModels() []string {
	return []string{
		"claude-sonnet-4-20250514",
		"claude-opus-4-20250514",
		"claude-haiku-3.5",
	}
}

func (c *Claude) IsAvailable() bool {
	_, err := exec.LookPath("claude")
	return err == nil
}

func (c *Claude) BuildCommand(opts runner.BuildCommandInput) runner.SpawnOptions {
	args := []string{"-p", opts.Task, "--output-format", "stream-json"}

	if opts.Model != "" {
		args = append(args, "--model", opts.Model)
	}
	if opts.McpConfigPath != "" {
		args = append(args, "--mcp-config", opts.McpConfigPath)
	}
	if opts.MaxTokens > 0 {
		args = append(args, "--max-turns", strconv.Itoa(opts.MaxTokens))
	}
	if opts.SystemPrompt != "" {
		args = append(args, "--system-prompt", opts.SystemPrompt)
	}
	for _, tool := range opts.AllowedTools {
		args = append(args, "--allowedTools", tool)
	}

	return runner.SpawnOptions{
		Command: "claude",
		Args:    args,
		WorkDir: opts.WorkDir,
	}
}

var (
	claudeCostRegex   = regexp.MustCompile(`Total cost:\s*\$([0-9.]+)`)
	claudeInputRegex  = regexp.MustCompile(`Input:\s*([0-9,]+)`)
	claudeOutputRegex = regexp.MustCompile(`Output:\s*([0-9,]+)`)
)

func (c *Claude) ParseTokenUsage(output string) (int64, int64) {
	var inp, out int64
	if m := claudeInputRegex.FindStringSubmatch(output); len(m) >= 2 {
		inp = parseTokenCount(m[1])
	}
	if m := claudeOutputRegex.FindStringSubmatch(output); len(m) >= 2 {
		out = parseTokenCount(m[1])
	}
	return inp, out
}

func (c *Claude) ParseCostUSD(output string) float64 {
	m := claudeCostRegex.FindStringSubmatch(output)
	if len(m) < 2 {
		return 0
	}
	cost, _ := strconv.ParseFloat(m[1], 64)
	return cost
}

func (c *Claude) DetectCompletion(output string) bool {
	return strings.Contains(output, "Total cost:")
}

func (c *Claude) DetectRateLimit(output string) bool {
	return strings.Contains(output, "rate_limit") || strings.Contains(output, "429")
}

func parseTokenCount(s string) int64 {
	s = strings.ReplaceAll(s, ",", "")
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}

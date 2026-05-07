package adapters

import (
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	runner "github.com/qwegle/setra/agent-runner"
)

// Gemini implements the Adapter interface for Google's Gemini CLI.
type Gemini struct{}

func (g *Gemini) Name() string        { return "gemini" }
func (g *Gemini) DisplayName() string  { return "Gemini CLI" }
func (g *Gemini) DefaultModel() string { return "gemini-2.5-pro" }

func (g *Gemini) SupportedModels() []string {
	return []string{"gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"}
}

func (g *Gemini) IsAvailable() bool {
	_, err := exec.LookPath("gemini")
	return err == nil
}

func (g *Gemini) BuildCommand(opts runner.BuildCommandInput) runner.SpawnOptions {
	args := []string{"-p", opts.Task}
	if opts.Model != "" {
		args = append(args, "--model", opts.Model)
	}
	return runner.SpawnOptions{
		Command: "gemini",
		Args:    args,
		WorkDir: opts.WorkDir,
	}
}

var (
	geminiTokenRegex = regexp.MustCompile(`Tokens used:\s*([0-9,]+)\s*\(input:\s*([0-9,]+)\s*/\s*output:\s*([0-9,]+)\)`)
	geminiCostRegex  = regexp.MustCompile(`Estimated cost:\s*\$([0-9.]+)`)
)

func (g *Gemini) ParseTokenUsage(output string) (int64, int64) {
	m := geminiTokenRegex.FindStringSubmatch(output)
	if len(m) < 4 {
		return 0, 0
	}
	return parseTokenCount(m[2]), parseTokenCount(m[3])
}

func (g *Gemini) ParseCostUSD(output string) float64 {
	m := geminiCostRegex.FindStringSubmatch(output)
	if len(m) < 2 {
		return 0
	}
	cost, _ := strconv.ParseFloat(m[1], 64)
	return cost
}

func (g *Gemini) DetectCompletion(output string) bool {
	return strings.Contains(output, "Estimated cost:")
}

func (g *Gemini) DetectRateLimit(output string) bool {
	return strings.Contains(output, "RESOURCE_EXHAUSTED") || strings.Contains(output, "429")
}

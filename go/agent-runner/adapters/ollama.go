package adapters

import (
	"os/exec"
	"regexp"
	"strings"

	runner "github.com/qwegle/setra/agent-runner"
)

// Ollama implements the Adapter interface for local Ollama models.
type Ollama struct{}

func (o *Ollama) Name() string        { return "ollama" }
func (o *Ollama) DisplayName() string  { return "Ollama (Local)" }
func (o *Ollama) DefaultModel() string { return "qwen2.5-coder:7b" }

func (o *Ollama) SupportedModels() []string {
	return []string{"qwen2.5-coder:7b", "qwen2.5-coder:32b", "deepseek-coder-v2:16b", "codellama:13b", "llama3.1:8b"}
}

func (o *Ollama) IsAvailable() bool {
	_, err := exec.LookPath("ollama")
	return err == nil
}

func (o *Ollama) BuildCommand(opts runner.BuildCommandInput) runner.SpawnOptions {
	model := opts.Model
	if model == "" {
		model = o.DefaultModel()
	}
	return runner.SpawnOptions{
		Command: "ollama",
		Args:    []string{"run", model},
		WorkDir: opts.WorkDir,
	}
}

var ollamaTokenRegex = regexp.MustCompile(`eval count:\s*([0-9]+)`)

func (o *Ollama) ParseTokenUsage(output string) (int64, int64) {
	m := ollamaTokenRegex.FindStringSubmatch(output)
	if len(m) < 2 {
		return 0, 0
	}
	return 0, parseTokenCount(m[1])
}

func (o *Ollama) ParseCostUSD(_ string) float64 { return 0 }

func (o *Ollama) DetectCompletion(output string) bool {
	return strings.Contains(output, "eval count:")
}

func (o *Ollama) DetectRateLimit(_ string) bool { return false }

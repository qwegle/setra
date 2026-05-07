package adapters

import (
	"testing"

	runner "github.com/qwegle/setra/agent-runner"
)

func TestClaudeAdapter(t *testing.T) {
	a := &Claude{}

	t.Run("Name", func(t *testing.T) {
		if a.Name() != "claude" {
			t.Errorf("Name = %q, want claude", a.Name())
		}
	})

	t.Run("DisplayName", func(t *testing.T) {
		if a.DisplayName() == "" {
			t.Error("DisplayName is empty")
		}
	})

	t.Run("DefaultModel", func(t *testing.T) {
		if a.DefaultModel() == "" {
			t.Error("DefaultModel is empty")
		}
	})

	t.Run("SupportedModels", func(t *testing.T) {
		models := a.SupportedModels()
		if len(models) == 0 {
			t.Error("SupportedModels is empty")
		}
	})

	t.Run("BuildCommand", func(t *testing.T) {
		opts := a.BuildCommand(runner.BuildCommandInput{
			WorkDir: "/tmp",
			Task:    "fix the bug",
			Model:   "claude-sonnet-4-20250514",
		})
		if opts.Command == "" {
			t.Error("Command is empty")
		}
		if opts.WorkDir != "/tmp" {
			t.Errorf("WorkDir = %q, want /tmp", opts.WorkDir)
		}
	})

	t.Run("ParseCostUSD", func(t *testing.T) {
		cost := a.ParseCostUSD("Total cost: $1.23\nSome other output")
		if cost != 1.23 {
			t.Errorf("ParseCostUSD = %f, want 1.23", cost)
		}

		cost = a.ParseCostUSD("no cost here")
		if cost != 0 {
			t.Errorf("ParseCostUSD(no match) = %f, want 0", cost)
		}
	})

	t.Run("ParseTokenUsage", func(t *testing.T) {
		inp, out := a.ParseTokenUsage("Input: 1,234\nOutput: 567\n")
		if inp != 1234 {
			t.Errorf("input tokens = %d, want 1234", inp)
		}
		if out != 567 {
			t.Errorf("output tokens = %d, want 567", out)
		}

		inp, out = a.ParseTokenUsage("no tokens")
		if inp != 0 || out != 0 {
			t.Errorf("expected 0/0 for no match, got %d/%d", inp, out)
		}
	})

	t.Run("DetectCompletion", func(t *testing.T) {
		if !a.DetectCompletion("Total cost: $1.23") {
			t.Error("should detect completion")
		}
		if a.DetectCompletion("still working...") {
			t.Error("should not detect completion on random text")
		}
	})
}

func TestGeminiAdapter(t *testing.T) {
	a := &Gemini{}

	if a.Name() != "gemini" {
		t.Errorf("Name = %q, want gemini", a.Name())
	}

	t.Run("BuildCommand", func(t *testing.T) {
		opts := a.BuildCommand(runner.BuildCommandInput{
			Task:    "review code",
			WorkDir: "/tmp",
		})
		if opts.Command == "" {
			t.Error("Command is empty")
		}
	})

	t.Run("ParseCostUSD", func(t *testing.T) {
		cost := a.ParseCostUSD("Estimated cost: $0.42")
		if cost != 0.42 {
			t.Errorf("ParseCostUSD = %f, want 0.42", cost)
		}
	})

	t.Run("ParseTokenUsage", func(t *testing.T) {
		inp, out := a.ParseTokenUsage("Tokens used: 500 (input: 300 / output: 200)")
		if inp != 300 {
			t.Errorf("input = %d, want 300", inp)
		}
		if out != 200 {
			t.Errorf("output = %d, want 200", out)
		}
	})
}

func TestCodexAdapter(t *testing.T) {
	a := &Codex{}

	if a.Name() != "codex" {
		t.Errorf("Name = %q, want codex", a.Name())
	}

	t.Run("ParseCostUSD", func(t *testing.T) {
		cost := a.ParseCostUSD("cost: $0.15")
		if cost != 0.15 {
			t.Errorf("ParseCostUSD = %f, want 0.15", cost)
		}
	})

	t.Run("ParseTokenUsage", func(t *testing.T) {
		inp, out := a.ParseTokenUsage("prompt tokens: 1000\ncompletion tokens: 500")
		if inp != 1000 {
			t.Errorf("input = %d, want 1000", inp)
		}
		if out != 500 {
			t.Errorf("output = %d, want 500", out)
		}
	})
}

func TestOllamaAdapter(t *testing.T) {
	a := &Ollama{}

	if a.Name() != "ollama" {
		t.Errorf("Name = %q, want ollama", a.Name())
	}
	if a.DefaultModel() == "" {
		t.Error("DefaultModel is empty")
	}

	t.Run("BuildCommand", func(t *testing.T) {
		opts := a.BuildCommand(runner.BuildCommandInput{
			Task:    "explain code",
			WorkDir: "/tmp",
			Model:   "llama3:8b",
		})
		if opts.Command == "" {
			t.Error("Command is empty")
		}
	})
}

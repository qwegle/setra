package runner

// Adapter defines the interface every AI model integration must implement.
// This mirrors the TypeScript AgentAdapter but is designed for Go's strengths:
// compiled regex, proper PTY handling, and efficient process management.
type Adapter interface {
	// Name returns the adapter identifier (e.g., "claude", "gemini", "codex").
	Name() string

	// DisplayName returns a human-friendly name.
	DisplayName() string

	// IsAvailable checks if the adapter's binary/API is accessible.
	IsAvailable() bool

	// DefaultModel returns the default model ID for this adapter.
	DefaultModel() string

	// SupportedModels returns the list of model IDs this adapter supports.
	SupportedModels() []string

	// BuildCommand constructs the spawn options for running the agent.
	BuildCommand(opts BuildCommandInput) SpawnOptions

	// ParseTokenUsage extracts token counts from the agent's output.
	ParseTokenUsage(output string) (input int64, output_ int64)

	// ParseCostUSD extracts the cost in USD from the agent's output.
	ParseCostUSD(output string) float64

	// DetectCompletion checks if the agent has finished its work.
	DetectCompletion(output string) bool

	// DetectRateLimit checks if the output indicates a rate limit.
	DetectRateLimit(output string) bool
}

// BuildCommandInput provides context for building an agent command.
type BuildCommandInput struct {
	WorkDir       string
	Task          string
	Model         string
	SystemPrompt  string
	McpConfigPath string
	MaxTokens     int
	AllowedTools  []string
}

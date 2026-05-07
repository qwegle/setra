package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	runner "github.com/qwegle/setra/agent-runner"
	"github.com/qwegle/setra/agent-runner/adapters"
)

var (
	engine *runner.Runner
	port   = "3142"
)

func main() {
	if p := os.Getenv("SETRA_RUNNER_PORT"); p != "" {
		port = p
	}

	engine = runner.New()

	engine.RegisterAdapter(&adapters.Claude{})
	engine.RegisterAdapter(&adapters.Gemini{})
	engine.RegisterAdapter(&adapters.Codex{})
	engine.RegisterAdapter(&adapters.Ollama{})

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("GET /adapters", handleListAdapters)
	mux.HandleFunc("POST /spawn", handleSpawn)
	mux.HandleFunc("POST /stop", handleStop)
	mux.HandleFunc("GET /output", handleOutput)
	mux.HandleFunc("POST /input", handleInput)
	mux.HandleFunc("GET /active", handleActive)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      recoveryMiddleware(requestLogMiddleware(corsMiddleware(mux))),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 300 * time.Second,
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("Shutting down runner...")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
	}()

	log.Printf("⚡ Setra Agent Runner listening on :%s\n", port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("PANIC recovered: %v (method=%s path=%s)", rec, r.Method, r.URL.Path)
				writeError(w, http.StatusInternalServerError, "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func requestLogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	adapterList := engine.ListAdapters()
	available := make([]string, 0)
	for _, a := range adapterList {
		if a.IsAvailable() {
			available = append(available, a.Name())
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":             "ok",
		"activeRuns":         engine.ActiveRuns(),
		"registeredAdapters": len(adapterList),
		"availableAdapters":  available,
	})
}

func handleListAdapters(w http.ResponseWriter, _ *http.Request) {
	adapterList := engine.ListAdapters()
	result := make([]map[string]any, 0, len(adapterList))
	for _, a := range adapterList {
		result = append(result, map[string]any{
			"name":         a.Name(),
			"displayName":  a.DisplayName(),
			"available":    a.IsAvailable(),
			"defaultModel": a.DefaultModel(),
			"models":       a.SupportedModels(),
		})
	}
	writeJSON(w, http.StatusOK, result)
}

type spawnRequest struct {
	RunID        string            `json:"runId"`
	Adapter      string            `json:"adapter"`
	Task         string            `json:"task"`
	Model        string            `json:"model"`
	WorkDir      string            `json:"workDir"`
	SystemPrompt string            `json:"systemPrompt"`
	McpConfig    string            `json:"mcpConfigPath"`
	MaxTokens    int               `json:"maxTokens"`
	TimeoutSec   int               `json:"timeoutSec"`
	Env          map[string]string `json:"env"`
}

func handleSpawn(w http.ResponseWriter, r *http.Request) {
	var req spawnRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.RunID == "" || req.Adapter == "" || req.Task == "" {
		writeError(w, http.StatusBadRequest, "runId, adapter, and task are required")
		return
	}

	adapter := engine.GetAdapter(req.Adapter)
	if adapter == nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown adapter: %s", req.Adapter))
		return
	}
	if !adapter.IsAvailable() {
		writeError(w, http.StatusServiceUnavailable, fmt.Sprintf("adapter %s not available", req.Adapter))
		return
	}

	opts := adapter.BuildCommand(runner.BuildCommandInput{
		WorkDir:       req.WorkDir,
		Task:          req.Task,
		Model:         req.Model,
		SystemPrompt:  req.SystemPrompt,
		McpConfigPath: req.McpConfig,
		MaxTokens:     req.MaxTokens,
	})
	if req.TimeoutSec > 0 {
		opts.Timeout = time.Duration(req.TimeoutSec) * time.Second
	}
	for k, v := range req.Env {
		if opts.Env == nil {
			opts.Env = make(map[string]string)
		}
		opts.Env[k] = v
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		result, err := engine.Spawn(context.Background(), req.RunID, opts)
		if err != nil {
			log.Printf("Run %s spawn error: %v", req.RunID, err)
			return
		}
		cost := adapter.ParseCostUSD(result.Output)
		inp, out := adapter.ParseTokenUsage(result.Output)
		log.Printf("Run %s done: exit=%d cost=$%.4f tokens=%d/%d dur=%s",
			req.RunID, result.ExitCode, cost, inp, out, result.Duration)
	}()

	writeJSON(w, http.StatusAccepted, map[string]any{
		"runId":   req.RunID,
		"status":  "spawned",
		"adapter": req.Adapter,
	})
}

type stopRequest struct {
	RunID string `json:"runId"`
}

func handleStop(w http.ResponseWriter, r *http.Request) {
	var req stopRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := engine.Stop(req.RunID); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}

func handleOutput(w http.ResponseWriter, r *http.Request) {
	runID := r.URL.Query().Get("runId")
	if runID == "" {
		writeError(w, http.StatusBadRequest, "runId query param required")
		return
	}
	output, err := engine.GetOutput(runID)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"output": output})
}

type inputRequest struct {
	RunID string `json:"runId"`
	Input string `json:"input"`
}

func handleInput(w http.ResponseWriter, r *http.Request) {
	var req inputRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := engine.WriteInput(req.RunID, req.Input); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

func handleActive(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]int{"activeRuns": engine.ActiveRuns()})
}

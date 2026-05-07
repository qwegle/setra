package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSetraDir(t *testing.T) {
	dir := SetraDir()
	if dir == "" {
		t.Fatal("SetraDir returned empty string")
	}
	home, _ := os.UserHomeDir()
	expected := filepath.Join(home, ".setra")
	if dir != expected {
		t.Errorf("SetraDir = %q, want %q", dir, expected)
	}
}

func TestLoadDefault(t *testing.T) {
	// Use a temp dir to avoid reading real config
	orig := os.Getenv("HOME")
	tmp := t.TempDir()
	os.Setenv("HOME", tmp)
	defer os.Setenv("HOME", orig)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.ServerURL != "http://localhost:3141" {
		t.Errorf("default ServerURL = %q, want http://localhost:3141", cfg.ServerURL)
	}
	// Theme defaults to empty (no default set)
	if cfg.Theme != "" {
		t.Errorf("default Theme = %q, want empty", cfg.Theme)
	}
}

func TestSaveAndLoad(t *testing.T) {
	tmp := t.TempDir()
	orig := os.Getenv("HOME")
	os.Setenv("HOME", tmp)
	defer os.Setenv("HOME", orig)

	cfg := &Config{
		ServerURL: "http://example.com:9999",
		AuthToken: "test-token-123",
		CompanyID: "company-abc",
		Theme:     "light",
	}

	if err := Save(cfg); err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	// Verify file exists
	path := filepath.Join(tmp, ".setra", "cli-config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("config file not created: %v", err)
	}

	var saved Config
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatalf("invalid JSON in config: %v", err)
	}
	if saved.ServerURL != cfg.ServerURL {
		t.Errorf("saved ServerURL = %q, want %q", saved.ServerURL, cfg.ServerURL)
	}
	if saved.AuthToken != cfg.AuthToken {
		t.Errorf("saved AuthToken = %q, want %q", saved.AuthToken, cfg.AuthToken)
	}

	// Load it back
	loaded, err := Load()
	if err != nil {
		t.Fatalf("Load() after Save() error: %v", err)
	}
	if loaded.ServerURL != cfg.ServerURL {
		t.Errorf("loaded ServerURL = %q, want %q", loaded.ServerURL, cfg.ServerURL)
	}
	if loaded.CompanyID != cfg.CompanyID {
		t.Errorf("loaded CompanyID = %q, want %q", loaded.CompanyID, cfg.CompanyID)
	}
}

func TestLoadInvalidJSON(t *testing.T) {
	tmp := t.TempDir()
	orig := os.Getenv("HOME")
	os.Setenv("HOME", tmp)
	defer os.Setenv("HOME", orig)

	// Write invalid JSON
	dir := filepath.Join(tmp, ".setra")
	os.MkdirAll(dir, 0755)
	os.WriteFile(filepath.Join(dir, "cli-config.json"), []byte("{invalid"), 0644)

	_, err := Load()
	if err == nil {
		t.Fatal("Load() should fail on invalid JSON")
	}
}

// Package config manages setra CLI configuration.
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	ServerURL string `json:"serverUrl"`
	AuthToken string `json:"authToken"`
	CompanyID string `json:"companyId"`
	Theme     string `json:"theme"`
}

var defaultConfig = Config{
	ServerURL: "http://localhost:3141",
}

func SetraDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".setra")
}

func configPath() string {
	return filepath.Join(SetraDir(), "cli-config.json")
}

func Load() (*Config, error) {
	cfg := defaultConfig

	data, err := os.ReadFile(configPath())
	if err != nil {
		if os.IsNotExist(err) {
			return &cfg, nil
		}
		return nil, err
	}

	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func Save(cfg *Config) error {
	if err := os.MkdirAll(SetraDir(), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath(), data, 0o644)
}

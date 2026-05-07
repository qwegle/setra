package commands

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
)

func StartCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "start",
		Short: "Start setra in the specified mode",
		Long: `Start setra platform in one of several modes:
  setra start --tui      Interactive terminal UI (default)
  setra start --cli      Command-line interactive shell
  setra start --web      Start web server + open browser dashboard
  setra start --desktop  Launch Electron desktop app
  setra start --all      Start server + runner + open desktop app`,
		RunE: func(cmd *cobra.Command, args []string) error {
			tuiFlag, _ := cmd.Flags().GetBool("tui")
			cliFlag, _ := cmd.Flags().GetBool("cli")
			webFlag, _ := cmd.Flags().GetBool("web")
			desktopFlag, _ := cmd.Flags().GetBool("desktop")
			allFlag, _ := cmd.Flags().GetBool("all")

			switch {
			case allFlag:
				return startAll()
			case webFlag:
				return startWeb()
			case desktopFlag:
				return startDesktop()
			case cliFlag:
				return startCLI()
			case tuiFlag:
				return startTUI()
			default:
				return startTUI()
			}
		},
	}

	cmd.Flags().Bool("tui", false, "Start in TUI mode (default)")
	cmd.Flags().Bool("cli", false, "Start in CLI mode")
	cmd.Flags().Bool("web", false, "Start web dashboard")
	cmd.Flags().Bool("desktop", false, "Start desktop app")
	cmd.Flags().Bool("all", false, "Start server + runner + desktop")

	return cmd
}

func startTUI() error {
	// Find setra-tui binary next to setra binary
	bin := findSibling("setra-tui")
	if bin == "" {
		color.Yellow("⚡ TUI binary not found. Building...")
		return fmt.Errorf("setra-tui not found in PATH or alongside setra binary")
	}

	cmd := exec.Command(bin)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func startCLI() error {
	bold := color.New(color.Bold)
	bold.Println("⚡ Setra CLI Shell")
	fmt.Println("  Type any setra command (without 'setra' prefix).")
	fmt.Println("  Commands: status, team, run, projects, issues, models, ledger, log")
	fmt.Println("  Type 'exit' or Ctrl+C to quit.")
	fmt.Println()
	return nil
}

func startWeb() error {
	color.Cyan("🌐 Starting Setra web server on http://localhost:3141 ...")
	root := findSetraRoot()

	cmd := exec.Command("pnpm", "dev")
	cmd.Dir = root
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start web server: %w", err)
	}

	openBrowser("http://localhost:3141")
	return cmd.Wait()
}

func startDesktop() error {
	color.Cyan("🖥  Starting Setra desktop app...")
	root := findSetraRoot()

	cmd := exec.Command("pnpm", "desktop")
	cmd.Dir = root
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func startAll() error {
	color.Cyan("⚡ Starting Setra Platform (server + runner + desktop)...")
	root := findSetraRoot()

	// Start agent runner in background
	runnerBin := findSibling("setra-runner")
	if runnerBin != "" {
		runner := exec.Command(runnerBin)
		runner.Stdout = os.Stdout
		runner.Stderr = os.Stderr
		if err := runner.Start(); err != nil {
			color.Yellow("  ⚠ Agent runner failed to start: %v", err)
		} else {
			color.Green("  ✓ Agent runner started on :3142")
		}
	}

	// Start web server + desktop
	webCmd := exec.Command("pnpm", "dev:all")
	webCmd.Dir = root
	webCmd.Stdout = os.Stdout
	webCmd.Stderr = os.Stderr
	return webCmd.Run()
}

func findSetraRoot() string {
	if root := os.Getenv("SETRA_ROOT"); root != "" {
		return root
	}
	// Walk up from CWD looking for package.json with setra
	dir, _ := os.Getwd()
	for {
		if _, err := os.Stat(filepath.Join(dir, "pnpm-workspace.yaml")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	home, _ := os.UserHomeDir()
	return home
}

func findSibling(name string) string {
	// Check next to the current binary
	exe, err := os.Executable()
	if err == nil {
		sibling := filepath.Join(filepath.Dir(exe), name)
		if _, err := os.Stat(sibling); err == nil {
			return sibling
		}
	}
	// Check PATH
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	return ""
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	}
	if cmd != nil {
		_ = cmd.Start()
	}
}

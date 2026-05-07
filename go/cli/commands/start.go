package commands

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"

	"github.com/spf13/cobra"
)

func StartCmd() *cobra.Command {
	var mode string

	cmd := &cobra.Command{
		Use:   "start",
		Short: "Start setra in the specified mode",
		Long: `Start setra platform in one of several modes:
  --tui      Interactive terminal UI (Bubble Tea)
  --cli      Command-line interactive shell
  --web      Start web server + open browser dashboard
  --desktop  Launch Electron desktop app
  --all      Start server + open desktop app`,
		RunE: func(cmd *cobra.Command, args []string) error {
			switch mode {
			case "tui":
				return startTUI()
			case "cli":
				return startCLI()
			case "web":
				return startWeb()
			case "desktop":
				return startDesktop()
			case "all":
				if err := startWeb(); err != nil {
					return err
				}
				return startDesktop()
			default:
				return startTUI()
			}
		},
	}

	cmd.Flags().StringVarP(&mode, "mode", "m", "tui", "Start mode: tui, cli, web, desktop, all")
	cmd.Flags().Bool("tui", false, "Start in TUI mode (shorthand)")
	cmd.Flags().Bool("cli", false, "Start in CLI mode (shorthand)")
	cmd.Flags().Bool("web", false, "Start web dashboard")
	cmd.Flags().Bool("desktop", false, "Start desktop app")

	return cmd
}

func startTUI() error {
	fmt.Println("🚀 Starting Setra TUI...")
	// TODO: Launch Bubble Tea TUI (go/tui)
	fmt.Println("TUI mode coming soon. Use --web or --desktop for now.")
	return nil
}

func startCLI() error {
	fmt.Println("🚀 Starting Setra CLI shell...")
	fmt.Println("Type 'help' for available commands, 'exit' to quit.")
	// TODO: Interactive REPL
	return nil
}

func startWeb() error {
	fmt.Println("🌐 Starting Setra web server on http://localhost:3141 ...")
	cmd := exec.Command("pnpm", "dev")
	cmd.Dir = findSetraRoot()
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Start()
}

func startDesktop() error {
	fmt.Println("🖥  Starting Setra desktop app...")
	cmd := exec.Command("pnpm", "desktop")
	cmd.Dir = findSetraRoot()
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Start()
}

func findSetraRoot() string {
	// Walk up from binary location or use env
	if root := os.Getenv("SETRA_ROOT"); root != "" {
		return root
	}
	home, _ := os.UserHomeDir()
	return home
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

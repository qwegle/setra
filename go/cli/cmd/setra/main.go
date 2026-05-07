package main

import (
	"fmt"
	"os"

	"github.com/qwegle/setra/cli/commands"
	"github.com/spf13/cobra"
)

var version = "dev"

func main() {
	root := &cobra.Command{
		Use:   "setra",
		Short: "Setra — AI agent orchestration platform",
		Long: `Setra is a multi-agent AI platform for software engineering.
Run AI coding agents anywhere, remember everything.

Start modes:
  setra start --tui     Interactive terminal UI (default)
  setra start --cli     Command-line shell
  setra start --web     Web dashboard (browser)
  setra start --desktop Electron desktop app`,
		Version:       version,
		SilenceErrors: true,
		SilenceUsage:  true,
	}

	root.AddCommand(
		commands.StartCmd(),
		commands.StatusCmd(),
		commands.RunCmd(),
		commands.TeamCmd(),
		commands.DispatchCmd(),
		commands.ProjectsCmd(),
		commands.IssuesCmd(),
		commands.LogCmd(),
		commands.ModelsCmd(),
		commands.LedgerCmd(),
		commands.InitCmd(),
		commands.CompanyCmd(),
	)

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

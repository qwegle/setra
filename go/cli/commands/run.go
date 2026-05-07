package commands

import (
	"fmt"

	"github.com/fatih/color"
	"github.com/qwegle/setra/pkg/client"
	"github.com/qwegle/setra/pkg/config"
	"github.com/spf13/cobra"
)

func RunCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "run [issue-id]",
		Short: "Dispatch an agent run for an issue",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, _ := config.Load()
			c := client.New(cfg)

			if len(args) == 0 {
				// List recent runs
				runs, err := c.ListRuns("")
				if err != nil {
					return err
				}
				if len(runs) == 0 {
					fmt.Println("No runs found.")
					return nil
				}
				bold := color.New(color.Bold)
				bold.Printf("Recent Runs (%d)\n\n", len(runs))
				for _, r := range runs {
					status := formatRunStatus(r.Status)
					fmt.Printf("  %s  %s  model=%s  cost=$%.4f\n",
						r.ID[:8], status, r.Model, r.CostUSD)
				}
				return nil
			}

			// Dispatch a run
			fmt.Printf("🚀 Dispatching run for issue %s...\n", args[0])
			return nil
		},
	}
}

func formatRunStatus(s string) string {
	switch s {
	case "running":
		return color.GreenString("● running")
	case "completed":
		return color.GreenString("✓ done")
	case "failed":
		return color.RedString("✗ failed")
	case "queued":
		return color.YellowString("⏳ queued")
	default:
		return s
	}
}

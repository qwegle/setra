package commands

import (
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/fatih/color"
	"github.com/qwegle/setra/pkg/client"
	"github.com/qwegle/setra/pkg/config"
	"github.com/spf13/cobra"
)

func TeamCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "team",
		Short: "List and manage AI agents in the roster",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, _ := config.Load()
			c := client.New(cfg)

			agents, err := c.ListAgents()
			if err != nil {
				return fmt.Errorf("list agents: %w", err)
			}

			if len(agents) == 0 {
				fmt.Println("No agents in roster. Hire agents from the dashboard.")
				return nil
			}

			bold := color.New(color.Bold)
			bold.Printf("⚡ Agent Roster (%d agents)\n\n", len(agents))

			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintf(w, "  NAME\tROLE\tMODEL\tSTATUS\tRUNS\tCOST\n")
			fmt.Fprintf(w, "  ────\t────\t─────\t──────\t────\t────\n")

			for _, a := range agents {
				status := formatStatus(string(a.Status))
				fmt.Fprintf(w, "  %s\t%s\t%s\t%s\t%d\t$%.2f\n",
					a.Name, a.Role, a.Model, status, a.TotalRuns, a.TotalCost)
			}
			w.Flush()
			return nil
		},
	}
	return cmd
}

func formatStatus(s string) string {
	switch s {
	case "running":
		return color.GreenString("● running")
	case "idle":
		return color.CyanString("○ idle")
	case "error":
		return color.RedString("✗ error")
	case "stopped":
		return color.YellowString("■ stopped")
	default:
		return s
	}
}

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

func StatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show platform status and health",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load()
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			c := client.New(cfg)
			health, err := c.Health()
			if err != nil {
				color.Red("✗ Server unreachable at %s", cfg.ServerURL)
				return err
			}

			bold := color.New(color.Bold)
			green := color.New(color.FgGreen)
			cyan := color.New(color.FgCyan)

			bold.Println("⚡ Setra Platform Status")
			fmt.Println()

			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintf(w, "  Server\t%s\n", green.Sprint("● online"))
			fmt.Fprintf(w, "  Version\t%s\n", health.Version)
			fmt.Fprintf(w, "  Uptime\t%.1f hours\n", health.Uptime/3600)
			fmt.Fprintf(w, "  Active Runs\t%s\n", cyan.Sprintf("%d", health.ActiveRun))
			w.Flush()

			// Show agents summary
			agents, err := c.ListAgents()
			if err == nil && len(agents) > 0 {
				running := 0
				for _, a := range agents {
					if a.Status == "running" {
						running++
					}
				}
				fmt.Println()
				bold.Printf("  Agents: %d total, %d running\n", len(agents), running)
			}

			return nil
		},
	}
}

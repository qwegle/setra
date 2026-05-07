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

func LogCmd() *cobra.Command {
	var runID string
	var follow bool

	cmd := &cobra.Command{
		Use:   "log [run-id]",
		Short: "View agent run logs",
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) > 0 {
				runID = args[0]
			}

			if runID == "" {
				// Show recent runs
				cfg, _ := config.Load()
				c := client.New(cfg)
				runs, err := c.ListRuns("")
				if err != nil {
					return err
				}

				bold := color.New(color.Bold)
				bold.Println("📜 Recent Runs")
				fmt.Println()

				w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
				fmt.Fprintf(w, "  ID\tSTATUS\tMODEL\tCOST\n")
				for _, r := range runs {
					fmt.Fprintf(w, "  %s\t%s\t%s\t$%.4f\n",
						r.ID[:8], formatRunStatus(r.Status), r.Model, r.CostUSD)
				}
				w.Flush()
				fmt.Println("\n  Use: setra log <run-id> to view full log")
				return nil
			}

			// TODO: Stream logs via SSE for --follow
			if follow {
				fmt.Printf("Following logs for run %s... (Ctrl+C to stop)\n", runID)
			}
			fmt.Printf("Fetching logs for run %s...\n", runID)
			return nil
		},
	}

	cmd.Flags().StringVarP(&runID, "run", "r", "", "Run ID")
	cmd.Flags().BoolVarP(&follow, "follow", "f", false, "Follow log output")
	return cmd
}

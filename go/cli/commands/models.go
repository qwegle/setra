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

func ModelsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "models",
		Short: "List available AI models",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, _ := config.Load()
			c := client.New(cfg)

			models, err := c.ListModels()
			if err != nil {
				return err
			}

			bold := color.New(color.Bold)
			bold.Printf("🤖 Available Models (%d)\n\n", len(models))

			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintf(w, "  NAME\tPROVIDER\tLOCAL\n")
			fmt.Fprintf(w, "  ────\t────────\t─────\n")
			for _, m := range models {
				local := "cloud"
				if m.IsLocal {
					local = color.GreenString("local")
				}
				fmt.Fprintf(w, "  %s\t%s\t%s\n", m.Name, m.Provider, local)
			}
			w.Flush()
			return nil
		},
	}
}

func LedgerCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "ledger",
		Short: "Show cost dashboard",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, _ := config.Load()
			c := client.New(cfg)

			costs, err := c.GetCosts()
			if err != nil {
				return err
			}

			bold := color.New(color.Bold)
			bold.Println("💰 Cost Ledger")
			fmt.Println()
			fmt.Printf("  Total Spend:    $%.4f\n", costs.TotalUSD)
			fmt.Printf("  Today:          $%.4f\n", costs.TodayUSD)
			fmt.Printf("  Budget Cap:     $%.2f\n", costs.BudgetCapUSD)
			fmt.Printf("  Input Tokens:   %d\n", costs.InputTokens)
			fmt.Printf("  Output Tokens:  %d\n", costs.OutputTokens)

			if costs.BudgetCapUSD > 0 {
				pct := (costs.TotalUSD / costs.BudgetCapUSD) * 100
				if pct > 80 {
					color.Yellow("\n  ⚠  Budget usage: %.1f%%", pct)
				} else {
					color.Green("\n  ✓  Budget usage: %.1f%%", pct)
				}
			}
			return nil
		},
	}
}

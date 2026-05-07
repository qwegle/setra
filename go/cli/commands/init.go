package commands

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/fatih/color"
	"github.com/qwegle/setra/pkg/client"
	"github.com/qwegle/setra/pkg/config"
	"github.com/spf13/cobra"
)

func InitCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "init",
		Short: "Initialize setra in the current project",
		RunE: func(cmd *cobra.Command, args []string) error {
			cwd, _ := os.Getwd()

			setraDir := filepath.Join(cwd, ".setra")
			if _, err := os.Stat(setraDir); err == nil {
				color.Yellow("⚠  Setra already initialized in %s", cwd)
				return nil
			}

			if err := os.MkdirAll(setraDir, 0o755); err != nil {
				return err
			}

			// Create local project config
			localCfg := `{
  "project": {
    "name": "` + filepath.Base(cwd) + `",
    "branch": "main"
  }
}
`
			cfgPath := filepath.Join(setraDir, "project.json")
			if err := os.WriteFile(cfgPath, []byte(localCfg), 0o644); err != nil {
				return err
			}

			color.Green("✓ Setra initialized in %s", cwd)
			fmt.Println("  Created .setra/project.json")
			fmt.Println()
			fmt.Println("  Next steps:")
			fmt.Println("    setra start        — Launch the platform")
			fmt.Println("    setra team         — View your agent roster")
			fmt.Println("    setra status       — Check platform health")
			return nil
		},
	}
}

func CompanyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "company",
		Short: "Manage companies/organizations",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, _ := config.Load()
			c := client.New(cfg)

			companies, err := c.ListCompanies()
			if err != nil {
				return err
			}

			if len(companies) == 0 {
				fmt.Println("No companies. Create one from the dashboard.")
				return nil
			}

			bold := color.New(color.Bold)
			bold.Printf("🏢 Companies (%d)\n\n", len(companies))
			for _, co := range companies {
				active := ""
				if co.ID == cfg.CompanyID {
					active = color.GreenString(" (active)")
				}
				fmt.Printf("  %s  %s%s\n", co.ID[:8], co.Name, active)
			}
			return nil
		},
	}

	switchCmd := &cobra.Command{
		Use:   "switch [company-id]",
		Short: "Switch active company",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, _ := config.Load()
			cfg.CompanyID = args[0]
			if err := config.Save(cfg); err != nil {
				return err
			}
			color.Green("✓ Switched to company %s", args[0])
			return nil
		},
	}

	cmd.AddCommand(switchCmd)
	return cmd
}

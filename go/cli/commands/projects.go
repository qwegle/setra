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

func ProjectsCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "projects",
		Aliases: []string{"project", "proj"},
		Short:   "List projects",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, _ := config.Load()
			c := client.New(cfg)

			projects, err := c.ListProjects()
			if err != nil {
				return err
			}

			if len(projects) == 0 {
				fmt.Println("No projects. Create one from the dashboard.")
				return nil
			}

			bold := color.New(color.Bold)
			bold.Printf("📁 Projects (%d)\n\n", len(projects))

			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintf(w, "  ID\tNAME\tBRANCH\n")
			fmt.Fprintf(w, "  ──\t────\t──────\n")
			for _, p := range projects {
				fmt.Fprintf(w, "  %s\t%s\t%s\n", p.ID[:8], p.Name, p.Branch)
			}
			w.Flush()
			return nil
		},
	}
}

func IssuesCmd() *cobra.Command {
	var projectID string

	cmd := &cobra.Command{
		Use:     "issues",
		Aliases: []string{"tasks", "kanban"},
		Short:   "List project issues/tasks",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, _ := config.Load()
			c := client.New(cfg)

			issues, err := c.ListIssues(projectID)
			if err != nil {
				return err
			}

			if len(issues) == 0 {
				fmt.Println("No issues found.")
				return nil
			}

			bold := color.New(color.Bold)
			bold.Printf("📋 Issues (%d)\n\n", len(issues))

			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintf(w, "  ID\tSTATUS\tPRIORITY\tTITLE\n")
			fmt.Fprintf(w, "  ──\t──────\t────────\t─────\n")
			for _, i := range issues {
				fmt.Fprintf(w, "  %s\t%s\t%s\t%s\n",
					i.ID[:8], i.Status, i.Priority, truncate(i.Title, 50))
			}
			w.Flush()
			return nil
		},
	}

	cmd.Flags().StringVarP(&projectID, "project", "p", "", "Filter by project ID")
	return cmd
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}

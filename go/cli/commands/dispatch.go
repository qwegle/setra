package commands

import (
	"fmt"

	"github.com/fatih/color"
	"github.com/qwegle/setra/pkg/client"
	"github.com/qwegle/setra/pkg/config"
	"github.com/spf13/cobra"
)

func DispatchCmd() *cobra.Command {
	var agentID string

	cmd := &cobra.Command{
		Use:   "dispatch [issue-id]",
		Short: "Dispatch an agent to work on an issue",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, _ := config.Load()
			c := client.New(cfg)

			issueID := args[0]
			if err := c.DispatchAgent(agentID, issueID); err != nil {
				return fmt.Errorf("dispatch failed: %w", err)
			}
			color.Green("✓ Agent dispatched to issue %s", issueID)
			return nil
		},
	}

	cmd.Flags().StringVarP(&agentID, "agent", "a", "", "Agent ID to dispatch")
	return cmd
}

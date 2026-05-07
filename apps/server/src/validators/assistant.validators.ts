import { z } from "zod";

// Assistant tool calls have a per-tool body shape (the route dispatches on
// :tool). Validate the outer envelope only — the handler does per-tool
// argument checks.
export const AssistantToolSchema = z.record(z.string(), z.unknown());

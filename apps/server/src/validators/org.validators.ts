import { z } from "zod";

export const OrgInviteSchema = z.object({
	email: z.string().min(1),
	role: z.string().optional(),
	companyId: z.string().optional(),
});

import { z } from "zod";

export const CreateLeadSchema = z.object({
	email: z.string().email().max(320),
	name: z.string().min(1).max(200).optional(),
	source: z.string().max(100).optional(),
	landingPageSlug: z.string().max(200).optional(),
	utmSource: z.string().max(100).optional(),
	utmMedium: z.string().max(100).optional(),
	utmCampaign: z.string().max(100).optional(),
	consent: z.boolean().optional(),
	metadata: z.record(z.unknown()).optional(),
});

export const UpdateLeadSchema = z.object({
	name: z.string().max(200).optional(),
	status: z
		.enum(["new", "contacted", "qualified", "converted", "lost", "blocked"])
		.optional(),
	metadata: z.record(z.unknown()).optional(),
});

export const CreateCampaignSchema = z.object({
	name: z.string().min(1).max(200),
	subject: z.string().min(1).max(200),
	bodyHtml: z.string().min(1).max(50000),
	segmentStatus: z
		.enum(["new", "contacted", "qualified", "converted", "lost", "blocked"])
		.optional(),
	scheduledAt: z.string().datetime().optional(),
});

export const SendCampaignSchema = z.object({
	dryRun: z.boolean().optional(),
});

export const CreateLandingPageSchema = z.object({
	slug: z
		.string()
		.min(1)
		.max(200)
		.regex(/^[a-z0-9][a-z0-9-]*$/, "must be kebab-case"),
	title: z.string().min(1).max(200),
	headline: z.string().min(1).max(200),
	subheadline: z.string().max(400).optional(),
	bodyMarkdown: z.string().max(50000).default(""),
	ctaLabel: z.string().max(100).optional(),
	ctaUrl: z.string().url().max(2000).optional(),
	captureForm: z.boolean().optional(),
	published: z.boolean().optional(),
});

export const UpdateLandingPageSchema = CreateLandingPageSchema.partial().omit({
	slug: true,
});

export const PublicCaptureSchema = z.object({
	email: z.string().email().max(320),
	name: z.string().max(200).optional(),
	utmSource: z.string().max(100).optional(),
	utmMedium: z.string().max(100).optional(),
	utmCampaign: z.string().max(100).optional(),
	consent: z.boolean().optional(),
});

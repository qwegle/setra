/**
 * Marketing routes.
 *
 * Authenticated endpoints (mounted under /api/marketing):
 *   GET    /leads                List leads (filter by status).
 *   POST   /leads                Create or upsert a lead.
 *   GET    /leads/:id            Get a single lead.
 *   PATCH  /leads/:id            Update lead status / metadata.
 *   DELETE /leads/:id            Delete a lead.
 *   GET    /leads.csv            Export leads as CSV.
 *   GET    /campaigns            List campaigns.
 *   POST   /campaigns            Create campaign in 'draft' status.
 *   GET    /campaigns/:id        Get campaign + recipients.
 *   POST   /campaigns/:id/send   Send a campaign via Resend.
 *   DELETE /campaigns/:id        Delete a campaign.
 *   GET    /landing-pages        List landing pages.
 *   POST   /landing-pages        Create landing page.
 *   GET    /landing-pages/:id    Read single landing page.
 *   PATCH  /landing-pages/:id    Update landing page.
 *   DELETE /landing-pages/:id    Delete landing page.
 *
 * Public endpoints (mounted under /api/public/marketing, unauthenticated):
 *   GET    /landing/:slug        Render the published landing page as HTML.
 *   POST   /landing/:slug/leads  Capture a lead from a landing-page form.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getCompanyId } from "../lib/company-scope.js";
import { getCompanySettings } from "../lib/company-settings.js";
import * as repo from "../repositories/marketing.repo.js";
import {
	CreateCampaignSchema,
	CreateLandingPageSchema,
	CreateLeadSchema,
	PublicCaptureSchema,
	SendCampaignSchema,
	UpdateLandingPageSchema,
	UpdateLeadSchema,
} from "../validators/marketing.validators.js";

export const marketingRoute = new Hono();
export const publicMarketingRoute = new Hono();

// ─── Leads ────────────────────────────────────────────────────────────────────

marketingRoute.get("/leads", (c) => {
	const cid = getCompanyId(c);
	const status = c.req.query("status") ?? undefined;
	const limit = Number(c.req.query("limit") ?? "200");
	return c.json({
		leads: repo.listLeads(cid, {
			...(status ? { status } : {}),
			limit: Number.isFinite(limit) ? limit : 200,
		}),
	});
});

marketingRoute.post("/leads", zValidator("json", CreateLeadSchema), (c) => {
	const cid = getCompanyId(c);
	const body = c.req.valid("json");
	const lead = repo.upsertLead({
		companyId: cid,
		email: body.email,
		...(body.name !== undefined ? { name: body.name } : {}),
		...(body.source !== undefined ? { source: body.source } : {}),
		...(body.landingPageSlug !== undefined
			? { landingPageSlug: body.landingPageSlug }
			: {}),
		...(body.utmSource !== undefined ? { utmSource: body.utmSource } : {}),
		...(body.utmMedium !== undefined ? { utmMedium: body.utmMedium } : {}),
		...(body.utmCampaign !== undefined
			? { utmCampaign: body.utmCampaign }
			: {}),
		...(body.consent !== undefined ? { consent: body.consent } : {}),
		...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
	});
	return c.json({ lead }, 201);
});

marketingRoute.get("/leads.csv", (c) => {
	const cid = getCompanyId(c);
	const rows = repo.listLeads(cid, { limit: 1000 });
	const header =
		"id,email,name,status,source,landingPageSlug,utmSource,utmMedium,utmCampaign,consent,createdAt";
	const csv = [header]
		.concat(
			rows.map((r) =>
				[
					r.id,
					r.email,
					csvCell(r.name ?? ""),
					r.status,
					csvCell(r.source ?? ""),
					csvCell(r.landingPageSlug ?? ""),
					csvCell(r.utmSource ?? ""),
					csvCell(r.utmMedium ?? ""),
					csvCell(r.utmCampaign ?? ""),
					r.consent ? "1" : "0",
					r.createdAt,
				].join(","),
			),
		)
		.join("\n");
	return new Response(csv, {
		headers: {
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": 'attachment; filename="leads.csv"',
		},
	});
});

function csvCell(v: string): string {
	if (/[,"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
	return v;
}

marketingRoute.get("/leads/:id", (c) => {
	const cid = getCompanyId(c);
	const lead = repo.getLead(c.req.param("id"), cid);
	if (!lead) return c.json({ error: "not_found" }, 404);
	return c.json({ lead });
});

marketingRoute.patch(
	"/leads/:id",
	zValidator("json", UpdateLeadSchema),
	(c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");
		const lead = repo.updateLead(c.req.param("id"), cid, {
			...(body.name !== undefined ? { name: body.name } : {}),
			...(body.status !== undefined ? { status: body.status } : {}),
			...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
		});
		if (!lead) return c.json({ error: "not_found" }, 404);
		return c.json({ lead });
	},
);

marketingRoute.delete("/leads/:id", (c) => {
	const cid = getCompanyId(c);
	const ok = repo.deleteLead(c.req.param("id"), cid);
	if (!ok) return c.json({ error: "not_found" }, 404);
	return c.json({ ok: true });
});

// ─── Campaigns ────────────────────────────────────────────────────────────────

marketingRoute.get("/campaigns", (c) => {
	const cid = getCompanyId(c);
	return c.json({ campaigns: repo.listCampaigns(cid) });
});

marketingRoute.post(
	"/campaigns",
	zValidator("json", CreateCampaignSchema),
	(c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");
		const campaign = repo.createCampaign({
			companyId: cid,
			name: body.name,
			subject: body.subject,
			bodyHtml: body.bodyHtml,
			...(body.segmentStatus !== undefined
				? { segmentStatus: body.segmentStatus }
				: {}),
			...(body.scheduledAt !== undefined
				? { scheduledAt: body.scheduledAt }
				: {}),
		});
		return c.json({ campaign }, 201);
	},
);

marketingRoute.get("/campaigns/:id", (c) => {
	const cid = getCompanyId(c);
	const campaign = repo.getCampaign(c.req.param("id"), cid);
	if (!campaign) return c.json({ error: "not_found" }, 404);
	const recipients = repo.listRecipients(campaign.id);
	return c.json({ campaign, recipients });
});

marketingRoute.delete("/campaigns/:id", (c) => {
	const cid = getCompanyId(c);
	const ok = repo.deleteCampaign(c.req.param("id"), cid);
	if (!ok) return c.json({ error: "not_found" }, 404);
	return c.json({ ok: true });
});

marketingRoute.post(
	"/campaigns/:id/send",
	zValidator("json", SendCampaignSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const id = c.req.param("id");
		const { dryRun } = c.req.valid("json");
		const campaign = repo.getCampaign(id, cid);
		if (!campaign) return c.json({ error: "not_found" }, 404);
		if (campaign.status === "running")
			return c.json({ error: "already_running" }, 409);

		const settings = getCompanySettings(cid) as Record<string, unknown>;
		const apiKey =
			(settings?.["resendApiKey"] as string | undefined) ||
			process.env["RESEND_API_KEY"] ||
			"";
		const fromEmail =
			(settings?.["marketingFromEmail"] as string | undefined) ||
			(settings?.["resendFromEmail"] as string | undefined) ||
			process.env["RESEND_FROM_EMAIL"] ||
			"";
		if (!dryRun && (!apiKey || !fromEmail)) {
			return c.json(
				{
					error: "resend_not_configured",
					hint: "Set company settings.resendApiKey and settings.marketingFromEmail.",
				},
				400,
			);
		}

		const targets = repo.listLeads(cid, {
			...(campaign.segmentStatus ? { status: campaign.segmentStatus } : {}),
			limit: 1000,
		});
		repo.enqueueRecipients(
			campaign.id,
			targets.map((t) => t.id),
		);
		repo.setCampaignStatus(campaign.id, cid, "running", {
			startedAt: new Date().toISOString(),
		});

		if (dryRun) {
			repo.setCampaignStatus(campaign.id, cid, "completed", {
				completedAt: new Date().toISOString(),
			});
			return c.json({
				ok: true,
				dryRun: true,
				queued: targets.length,
			});
		}

		// Best-effort sequential send. Resend rate-limits ~10 req/sec; we keep
		// it linear and rely on the campaign status to surface progress.
		const pending = repo.listPendingRecipients(campaign.id);
		let sent = 0;
		let failed = 0;
		for (const recipient of pending) {
			const lead = targets.find((t) => t.id === recipient.leadId);
			if (!lead) {
				repo.markRecipientFailed(recipient.id, "lead_not_found");
				failed += 1;
				continue;
			}
			try {
				const res = await fetch("https://api.resend.com/emails", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						from: fromEmail,
						to: lead.email,
						subject: campaign.subject,
						html: campaign.bodyHtml,
					}),
				});
				if (!res.ok) {
					const text = await res.text().catch(() => "");
					repo.markRecipientFailed(
						recipient.id,
						`http_${res.status}:${text.slice(0, 200)}`,
					);
					failed += 1;
					continue;
				}
				const json = (await res.json().catch(() => null)) as {
					id?: string;
				} | null;
				repo.markRecipientSent(recipient.id, json?.id ?? null);
				sent += 1;
			} catch (err) {
				repo.markRecipientFailed(
					recipient.id,
					err instanceof Error ? err.message : String(err),
				);
				failed += 1;
			}
		}

		repo.incCampaignCounters(campaign.id, { sent, failed });
		repo.setCampaignStatus(
			campaign.id,
			cid,
			failed > 0 && sent === 0 ? "failed" : "completed",
			{ completedAt: new Date().toISOString() },
		);
		return c.json({ ok: true, sent, failed, total: pending.length });
	},
);

// ─── Landing pages ────────────────────────────────────────────────────────────

marketingRoute.get("/landing-pages", (c) => {
	const cid = getCompanyId(c);
	return c.json({ landingPages: repo.listLandingPages(cid) });
});

marketingRoute.post(
	"/landing-pages",
	zValidator("json", CreateLandingPageSchema),
	(c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");
		try {
			const page = repo.createLandingPage({
				companyId: cid,
				slug: body.slug,
				title: body.title,
				headline: body.headline,
				bodyMarkdown: body.bodyMarkdown ?? "",
				...(body.subheadline !== undefined
					? { subheadline: body.subheadline }
					: {}),
				...(body.ctaLabel !== undefined ? { ctaLabel: body.ctaLabel } : {}),
				...(body.ctaUrl !== undefined ? { ctaUrl: body.ctaUrl } : {}),
				...(body.captureForm !== undefined
					? { captureForm: body.captureForm }
					: {}),
				...(body.published !== undefined ? { published: body.published } : {}),
			});
			return c.json({ landingPage: page }, 201);
		} catch (err) {
			if (
				err instanceof Error &&
				err.message.includes("UNIQUE constraint failed")
			) {
				return c.json({ error: "slug_taken" }, 409);
			}
			throw err;
		}
	},
);

marketingRoute.get("/landing-pages/:id", (c) => {
	const cid = getCompanyId(c);
	const page = repo.getLandingPageById(c.req.param("id"), cid);
	if (!page) return c.json({ error: "not_found" }, 404);
	return c.json({ landingPage: page });
});

marketingRoute.patch(
	"/landing-pages/:id",
	zValidator("json", UpdateLandingPageSchema),
	(c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");
		const patch: Partial<{
			title: string;
			headline: string;
			subheadline: string;
			bodyMarkdown: string;
			ctaLabel: string;
			ctaUrl: string;
			captureForm: boolean;
			published: boolean;
		}> = {};
		if (body.title !== undefined) patch.title = body.title;
		if (body.headline !== undefined) patch.headline = body.headline;
		if (body.subheadline !== undefined) patch.subheadline = body.subheadline;
		if (body.bodyMarkdown !== undefined)
			patch.bodyMarkdown = body.bodyMarkdown;
		if (body.ctaLabel !== undefined) patch.ctaLabel = body.ctaLabel;
		if (body.ctaUrl !== undefined) patch.ctaUrl = body.ctaUrl;
		if (body.captureForm !== undefined) patch.captureForm = body.captureForm;
		if (body.published !== undefined) patch.published = body.published;
		const page = repo.updateLandingPage(c.req.param("id"), cid, patch);
		if (!page) return c.json({ error: "not_found" }, 404);
		return c.json({ landingPage: page });
	},
);

marketingRoute.delete("/landing-pages/:id", (c) => {
	const cid = getCompanyId(c);
	const ok = repo.deleteLandingPage(c.req.param("id"), cid);
	if (!ok) return c.json({ error: "not_found" }, 404);
	return c.json({ ok: true });
});

// ─── Public surface ───────────────────────────────────────────────────────────

publicMarketingRoute.get("/landing/:slug", (c) => {
	const slug = c.req.param("slug");
	const page = repo.getPublishedLandingBySlug(slug);
	if (!page) return c.text("Not found", 404);
	repo.incLandingViewCount(page.id);
	return c.html(renderLandingHtml(page));
});

publicMarketingRoute.post(
	"/landing/:slug/leads",
	zValidator("json", PublicCaptureSchema),
	(c) => {
		const slug = c.req.param("slug");
		const page = repo.getPublishedLandingBySlug(slug);
		if (!page || !page.captureForm) return c.json({ error: "not_found" }, 404);
		const body = c.req.valid("json");
		const lead = repo.upsertLead({
			companyId: page.companyId,
			email: body.email,
			source: "landing_page",
			landingPageSlug: page.slug,
			...(body.name !== undefined ? { name: body.name } : {}),
			...(body.utmSource !== undefined ? { utmSource: body.utmSource } : {}),
			...(body.utmMedium !== undefined ? { utmMedium: body.utmMedium } : {}),
			...(body.utmCampaign !== undefined
				? { utmCampaign: body.utmCampaign }
				: {}),
			...(body.consent !== undefined ? { consent: body.consent } : {}),
		});
		return c.json({ ok: true, leadId: lead.id }, 201);
	},
);

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function renderMarkdown(md: string): string {
	const escaped = escapeHtml(md);
	return escaped
		.split(/\n{2,}/)
		.map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`)
		.join("");
}

function renderLandingHtml(page: repo.LandingPage): string {
	const subheadline = page.subheadline
		? `<p class="subheadline">${escapeHtml(page.subheadline)}</p>`
		: "";
	const captureForm = page.captureForm
		? `<form id="capture-form" onsubmit="return submitLead(event)">
        <input required type="email" name="email" placeholder="Work email" />
        <input type="text" name="name" placeholder="Full name" />
        <button type="submit">${escapeHtml(page.ctaLabel)}</button>
        <p id="capture-status"></p>
      </form>
      <script>
        async function submitLead(e) {
          e.preventDefault();
          const f = e.target;
          const status = document.getElementById('capture-status');
          status.textContent = 'Sending…';
          try {
            const r = await fetch('/api/public/marketing/landing/${encodeURIComponent(page.slug)}/leads', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: f.email.value, name: f.name.value || undefined })
            });
            status.textContent = r.ok ? 'Thanks. We will be in touch.' : 'Submission failed.';
            if (r.ok) f.reset();
          } catch (_) {
            status.textContent = 'Submission failed.';
          }
          return false;
        }
      </script>`
		: page.ctaUrl
			? `<a class="cta" href="${escapeHtml(page.ctaUrl)}">${escapeHtml(page.ctaLabel)}</a>`
			: "";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(page.title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         margin: 0; padding: 0; color: #0f172a; background: #f8fafc; }
  main { max-width: 760px; margin: 0 auto; padding: 64px 24px; }
  h1 { font-size: 2.5rem; line-height: 1.2; margin: 0 0 16px; }
  .subheadline { font-size: 1.15rem; color: #475569; margin: 0 0 32px; }
  .body { font-size: 1rem; line-height: 1.6; color: #1e293b; }
  form { display: flex; flex-direction: column; gap: 12px; max-width: 420px; margin-top: 32px; }
  input { padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 1rem; }
  button, a.cta { display: inline-block; background: #0f172a; color: #fff; border: none;
                  padding: 12px 18px; border-radius: 6px; font-size: 1rem; cursor: pointer;
                  text-decoration: none; text-align: center; }
  #capture-status { color: #475569; min-height: 1.2em; margin: 0; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(page.headline)}</h1>
  ${subheadline}
  <div class="body">${renderMarkdown(page.bodyMarkdown)}</div>
  ${captureForm}
</main>
</body>
</html>`;
}

/**
 * Marketing repository: leads, campaigns, landing pages.
 *
 * Backed by SQLite (migration 0012_marketing.sql). All queries are
 * company-scoped by primary index. Lead capture is upsert-friendly so the
 * public capture endpoint never errors on duplicate submissions.
 */

import { randomUUID } from "node:crypto";
import { rawSqlite } from "../db/client.js";

const nowIso = () => new Date().toISOString();

export interface Lead {
	id: string;
	companyId: string;
	email: string;
	name: string | null;
	source: string | null;
	landingPageSlug: string | null;
	utmSource: string | null;
	utmMedium: string | null;
	utmCampaign: string | null;
	consent: boolean;
	metadata: Record<string, unknown>;
	status: string;
	createdAt: string;
	updatedAt: string;
}

interface LeadRow {
	id: string;
	company_id: string;
	email: string;
	name: string | null;
	source: string | null;
	landing_page_slug: string | null;
	utm_source: string | null;
	utm_medium: string | null;
	utm_campaign: string | null;
	consent: number;
	metadata_json: string;
	status: string;
	created_at: string;
	updated_at: string;
}

function rowToLead(row: LeadRow): Lead {
	return {
		id: row.id,
		companyId: row.company_id,
		email: row.email,
		name: row.name,
		source: row.source,
		landingPageSlug: row.landing_page_slug,
		utmSource: row.utm_source,
		utmMedium: row.utm_medium,
		utmCampaign: row.utm_campaign,
		consent: row.consent === 1,
		metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export interface UpsertLeadParams {
	companyId: string;
	email: string;
	name?: string | undefined;
	source?: string | undefined;
	landingPageSlug?: string | undefined;
	utmSource?: string | undefined;
	utmMedium?: string | undefined;
	utmCampaign?: string | undefined;
	consent?: boolean | undefined;
	metadata?: Record<string, unknown> | undefined;
}

export function upsertLead(params: UpsertLeadParams): Lead {
	const ts = nowIso();
	const existing = rawSqlite
		.prepare(`SELECT * FROM marketing_leads WHERE company_id = ? AND email = ?`)
		.get(params.companyId, params.email.toLowerCase()) as LeadRow | undefined;
	if (existing) {
		rawSqlite
			.prepare(
				`UPDATE marketing_leads SET
           name = COALESCE(?, name),
           source = COALESCE(?, source),
           landing_page_slug = COALESCE(?, landing_page_slug),
           utm_source = COALESCE(?, utm_source),
           utm_medium = COALESCE(?, utm_medium),
           utm_campaign = COALESCE(?, utm_campaign),
           consent = ?,
           metadata_json = ?,
           updated_at = ?
         WHERE id = ?`,
			)
			.run(
				params.name ?? null,
				params.source ?? null,
				params.landingPageSlug ?? null,
				params.utmSource ?? null,
				params.utmMedium ?? null,
				params.utmCampaign ?? null,
				params.consent === false
					? 0
					: params.consent === true
						? 1
						: existing.consent,
				JSON.stringify({
					...(JSON.parse(existing.metadata_json) as Record<string, unknown>),
					...(params.metadata ?? {}),
				}),
				ts,
				existing.id,
			);
		const updated = rawSqlite
			.prepare(`SELECT * FROM marketing_leads WHERE id = ?`)
			.get(existing.id) as LeadRow;
		return rowToLead(updated);
	}
	const id = randomUUID();
	rawSqlite
		.prepare(
			`INSERT INTO marketing_leads
         (id, company_id, email, name, source, landing_page_slug,
          utm_source, utm_medium, utm_campaign, consent, metadata_json,
          status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
		)
		.run(
			id,
			params.companyId,
			params.email.toLowerCase(),
			params.name ?? null,
			params.source ?? null,
			params.landingPageSlug ?? null,
			params.utmSource ?? null,
			params.utmMedium ?? null,
			params.utmCampaign ?? null,
			params.consent ? 1 : 0,
			JSON.stringify(params.metadata ?? {}),
			ts,
			ts,
		);
	return rowToLead(
		rawSqlite
			.prepare(`SELECT * FROM marketing_leads WHERE id = ?`)
			.get(id) as LeadRow,
	);
}

export function listLeads(
	companyId: string,
	opts: { status?: string; limit?: number } = {},
): Lead[] {
	const limit = Math.max(1, Math.min(opts.limit ?? 200, 1000));
	const where: string[] = ["company_id = ?"];
	const args: unknown[] = [companyId];
	if (opts.status) {
		where.push("status = ?");
		args.push(opts.status);
	}
	args.push(limit);
	const rows = rawSqlite
		.prepare(
			`SELECT * FROM marketing_leads WHERE ${where.join(" AND ")}
         ORDER BY created_at DESC LIMIT ?`,
		)
		.all(...args) as LeadRow[];
	return rows.map(rowToLead);
}

export function getLead(id: string, companyId: string): Lead | null {
	const row = rawSqlite
		.prepare(`SELECT * FROM marketing_leads WHERE id = ? AND company_id = ?`)
		.get(id, companyId) as LeadRow | undefined;
	return row ? rowToLead(row) : null;
}

export function updateLead(
	id: string,
	companyId: string,
	patch: { name?: string; status?: string; metadata?: Record<string, unknown> },
): Lead | null {
	const existing = getLead(id, companyId);
	if (!existing) return null;
	rawSqlite
		.prepare(
			`UPDATE marketing_leads SET
         name = COALESCE(?, name),
         status = COALESCE(?, status),
         metadata_json = ?,
         updated_at = ?
       WHERE id = ? AND company_id = ?`,
		)
		.run(
			patch.name ?? null,
			patch.status ?? null,
			JSON.stringify({ ...existing.metadata, ...(patch.metadata ?? {}) }),
			nowIso(),
			id,
			companyId,
		);
	return getLead(id, companyId);
}

export function deleteLead(id: string, companyId: string): boolean {
	const result = rawSqlite
		.prepare(`DELETE FROM marketing_leads WHERE id = ? AND company_id = ?`)
		.run(id, companyId);
	return result.changes > 0;
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export interface Campaign {
	id: string;
	companyId: string;
	name: string;
	subject: string;
	bodyHtml: string;
	segmentStatus: string | null;
	status: string;
	scheduledAt: string | null;
	startedAt: string | null;
	completedAt: string | null;
	sentCount: number;
	failedCount: number;
	createdBy: string | null;
	createdAt: string;
	updatedAt: string;
}

interface CampaignRow {
	id: string;
	company_id: string;
	name: string;
	subject: string;
	body_html: string;
	segment_status: string | null;
	status: string;
	scheduled_at: string | null;
	started_at: string | null;
	completed_at: string | null;
	sent_count: number;
	failed_count: number;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}

function rowToCampaign(row: CampaignRow): Campaign {
	return {
		id: row.id,
		companyId: row.company_id,
		name: row.name,
		subject: row.subject,
		bodyHtml: row.body_html,
		segmentStatus: row.segment_status,
		status: row.status,
		scheduledAt: row.scheduled_at,
		startedAt: row.started_at,
		completedAt: row.completed_at,
		sentCount: row.sent_count,
		failedCount: row.failed_count,
		createdBy: row.created_by,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export interface CreateCampaignParams {
	companyId: string;
	name: string;
	subject: string;
	bodyHtml: string;
	segmentStatus?: string | undefined;
	scheduledAt?: string | undefined;
	createdBy?: string | undefined;
}

export function createCampaign(params: CreateCampaignParams): Campaign {
	const id = randomUUID();
	const ts = nowIso();
	rawSqlite
		.prepare(
			`INSERT INTO marketing_campaigns
         (id, company_id, name, subject, body_html, segment_status,
          status, scheduled_at, sent_count, failed_count,
          created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, 0, 0, ?, ?, ?)`,
		)
		.run(
			id,
			params.companyId,
			params.name,
			params.subject,
			params.bodyHtml,
			params.segmentStatus ?? null,
			params.scheduledAt ?? null,
			params.createdBy ?? null,
			ts,
			ts,
		);
	return rowToCampaign(
		rawSqlite
			.prepare(`SELECT * FROM marketing_campaigns WHERE id = ?`)
			.get(id) as CampaignRow,
	);
}

export function listCampaigns(companyId: string): Campaign[] {
	const rows = rawSqlite
		.prepare(
			`SELECT * FROM marketing_campaigns WHERE company_id = ?
         ORDER BY created_at DESC LIMIT 200`,
		)
		.all(companyId) as CampaignRow[];
	return rows.map(rowToCampaign);
}

export function getCampaign(id: string, companyId: string): Campaign | null {
	const row = rawSqlite
		.prepare(
			`SELECT * FROM marketing_campaigns WHERE id = ? AND company_id = ?`,
		)
		.get(id, companyId) as CampaignRow | undefined;
	return row ? rowToCampaign(row) : null;
}

export function setCampaignStatus(
	id: string,
	companyId: string,
	status: "draft" | "running" | "completed" | "failed",
	patch: { startedAt?: string; completedAt?: string } = {},
): void {
	rawSqlite
		.prepare(
			`UPDATE marketing_campaigns SET
         status = ?,
         started_at = COALESCE(?, started_at),
         completed_at = COALESCE(?, completed_at),
         updated_at = ?
       WHERE id = ? AND company_id = ?`,
		)
		.run(
			status,
			patch.startedAt ?? null,
			patch.completedAt ?? null,
			nowIso(),
			id,
			companyId,
		);
}

export function incCampaignCounters(
	id: string,
	delta: { sent?: number; failed?: number },
): void {
	rawSqlite
		.prepare(
			`UPDATE marketing_campaigns SET
         sent_count = sent_count + ?,
         failed_count = failed_count + ?,
         updated_at = ?
       WHERE id = ?`,
		)
		.run(delta.sent ?? 0, delta.failed ?? 0, nowIso(), id);
}

export function deleteCampaign(id: string, companyId: string): boolean {
	const result = rawSqlite
		.prepare(`DELETE FROM marketing_campaigns WHERE id = ? AND company_id = ?`)
		.run(id, companyId);
	return result.changes > 0;
}

// ─── Recipients ───────────────────────────────────────────────────────────────

export function enqueueRecipients(
	campaignId: string,
	leadIds: string[],
): number {
	if (leadIds.length === 0) return 0;
	const insert = rawSqlite.prepare(
		`INSERT OR IGNORE INTO marketing_campaign_recipients
       (id, campaign_id, lead_id, status) VALUES (?, ?, ?, 'pending')`,
	);
	const tx = rawSqlite.transaction((ids: string[]) => {
		let inserted = 0;
		for (const leadId of ids) {
			const r = insert.run(randomUUID(), campaignId, leadId);
			if (r.changes > 0) inserted += 1;
		}
		return inserted;
	});
	return tx(leadIds) as number;
}

export interface Recipient {
	id: string;
	campaignId: string;
	leadId: string;
	status: string;
	resendMessageId: string | null;
	errorMessage: string | null;
	sentAt: string | null;
}

interface RecipientRow {
	id: string;
	campaign_id: string;
	lead_id: string;
	status: string;
	resend_message_id: string | null;
	error_message: string | null;
	sent_at: string | null;
}

function rowToRecipient(row: RecipientRow): Recipient {
	return {
		id: row.id,
		campaignId: row.campaign_id,
		leadId: row.lead_id,
		status: row.status,
		resendMessageId: row.resend_message_id,
		errorMessage: row.error_message,
		sentAt: row.sent_at,
	};
}

export function listPendingRecipients(campaignId: string): Recipient[] {
	const rows = rawSqlite
		.prepare(
			`SELECT * FROM marketing_campaign_recipients
         WHERE campaign_id = ? AND status = 'pending'
         ORDER BY id ASC LIMIT 500`,
		)
		.all(campaignId) as RecipientRow[];
	return rows.map(rowToRecipient);
}

export function listRecipients(campaignId: string): Recipient[] {
	const rows = rawSqlite
		.prepare(
			`SELECT * FROM marketing_campaign_recipients
         WHERE campaign_id = ? ORDER BY id ASC LIMIT 1000`,
		)
		.all(campaignId) as RecipientRow[];
	return rows.map(rowToRecipient);
}

export function markRecipientSent(
	id: string,
	resendMessageId: string | null,
): void {
	rawSqlite
		.prepare(
			`UPDATE marketing_campaign_recipients SET
         status = 'sent', resend_message_id = ?, sent_at = ? WHERE id = ?`,
		)
		.run(resendMessageId, nowIso(), id);
}

export function markRecipientFailed(id: string, error: string): void {
	rawSqlite
		.prepare(
			`UPDATE marketing_campaign_recipients SET
         status = 'failed', error_message = ?, sent_at = ? WHERE id = ?`,
		)
		.run(error.slice(0, 500), nowIso(), id);
}

// ─── Landing pages ────────────────────────────────────────────────────────────

export interface LandingPage {
	id: string;
	companyId: string;
	slug: string;
	title: string;
	headline: string;
	subheadline: string | null;
	bodyMarkdown: string;
	ctaLabel: string;
	ctaUrl: string | null;
	captureForm: boolean;
	published: boolean;
	viewCount: number;
	createdAt: string;
	updatedAt: string;
}

interface LandingRow {
	id: string;
	company_id: string;
	slug: string;
	title: string;
	headline: string;
	subheadline: string | null;
	body_markdown: string;
	cta_label: string;
	cta_url: string | null;
	capture_form: number;
	published: number;
	view_count: number;
	created_at: string;
	updated_at: string;
}

function rowToLanding(row: LandingRow): LandingPage {
	return {
		id: row.id,
		companyId: row.company_id,
		slug: row.slug,
		title: row.title,
		headline: row.headline,
		subheadline: row.subheadline,
		bodyMarkdown: row.body_markdown,
		ctaLabel: row.cta_label,
		ctaUrl: row.cta_url,
		captureForm: row.capture_form === 1,
		published: row.published === 1,
		viewCount: row.view_count,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export interface CreateLandingParams {
	companyId: string;
	slug: string;
	title: string;
	headline: string;
	subheadline?: string | undefined;
	bodyMarkdown?: string | undefined;
	ctaLabel?: string | undefined;
	ctaUrl?: string | undefined;
	captureForm?: boolean | undefined;
	published?: boolean | undefined;
}

export function createLandingPage(params: CreateLandingParams): LandingPage {
	const id = randomUUID();
	const ts = nowIso();
	rawSqlite
		.prepare(
			`INSERT INTO marketing_landing_pages
         (id, company_id, slug, title, headline, subheadline, body_markdown,
          cta_label, cta_url, capture_form, published, view_count,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		)
		.run(
			id,
			params.companyId,
			params.slug,
			params.title,
			params.headline,
			params.subheadline ?? null,
			params.bodyMarkdown ?? "",
			params.ctaLabel ?? "Get started",
			params.ctaUrl ?? null,
			params.captureForm === false ? 0 : 1,
			params.published ? 1 : 0,
			ts,
			ts,
		);
	return rowToLanding(
		rawSqlite
			.prepare(`SELECT * FROM marketing_landing_pages WHERE id = ?`)
			.get(id) as LandingRow,
	);
}

export function listLandingPages(companyId: string): LandingPage[] {
	const rows = rawSqlite
		.prepare(
			`SELECT * FROM marketing_landing_pages WHERE company_id = ?
         ORDER BY created_at DESC LIMIT 200`,
		)
		.all(companyId) as LandingRow[];
	return rows.map(rowToLanding);
}

export function getLandingPageById(
	id: string,
	companyId: string,
): LandingPage | null {
	const row = rawSqlite
		.prepare(
			`SELECT * FROM marketing_landing_pages WHERE id = ? AND company_id = ?`,
		)
		.get(id, companyId) as LandingRow | undefined;
	return row ? rowToLanding(row) : null;
}

export function getPublishedLandingBySlug(slug: string): LandingPage | null {
	const row = rawSqlite
		.prepare(
			`SELECT * FROM marketing_landing_pages WHERE slug = ? AND published = 1 LIMIT 1`,
		)
		.get(slug) as LandingRow | undefined;
	return row ? rowToLanding(row) : null;
}

export function updateLandingPage(
	id: string,
	companyId: string,
	patch: Partial<CreateLandingParams>,
): LandingPage | null {
	const existing = getLandingPageById(id, companyId);
	if (!existing) return null;
	rawSqlite
		.prepare(
			`UPDATE marketing_landing_pages SET
         title = ?, headline = ?, subheadline = ?, body_markdown = ?,
         cta_label = ?, cta_url = ?, capture_form = ?, published = ?,
         updated_at = ?
       WHERE id = ? AND company_id = ?`,
		)
		.run(
			patch.title ?? existing.title,
			patch.headline ?? existing.headline,
			patch.subheadline ?? existing.subheadline,
			patch.bodyMarkdown ?? existing.bodyMarkdown,
			patch.ctaLabel ?? existing.ctaLabel,
			patch.ctaUrl ?? existing.ctaUrl,
			patch.captureForm === undefined
				? existing.captureForm
					? 1
					: 0
				: patch.captureForm
					? 1
					: 0,
			patch.published === undefined
				? existing.published
					? 1
					: 0
				: patch.published
					? 1
					: 0,
			nowIso(),
			id,
			companyId,
		);
	return getLandingPageById(id, companyId);
}

export function incLandingViewCount(id: string): void {
	rawSqlite
		.prepare(
			`UPDATE marketing_landing_pages SET view_count = view_count + 1 WHERE id = ?`,
		)
		.run(id);
}

export function deleteLandingPage(id: string, companyId: string): boolean {
	const result = rawSqlite
		.prepare(
			`DELETE FROM marketing_landing_pages WHERE id = ? AND company_id = ?`,
		)
		.run(id, companyId);
	return result.changes > 0;
}

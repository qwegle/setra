/**
 * Marketing repository tests.
 *
 * Covers leads upsert, campaign lifecycle, and landing-page CRUD.
 * Uses the cross-handle pattern: SETRA_DATA_DIR is set before any imports,
 * the raw sqlite handle is opened, and the marketing tables are created
 * directly so we don't depend on the migration runner inside vitest.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let tmpDir: string;
let raw: InstanceType<typeof Database>;
let repo: typeof import("../repositories/marketing.repo.js");

beforeAll(async () => {
	tmpDir = mkdtempSync(join(tmpdir(), "setra-mk-"));
	mkdirSync(join(tmpDir, ".setra"), { recursive: true });
	process.env["HOME"] = tmpDir;
	process.env["SETRA_DATA_DIR"] = join(tmpDir, ".setra");

	const { getDb, getRawDb } = await import("@setra/db");
	getDb({ dbPath: join(tmpDir, ".setra", "setra.db") });
	raw = getRawDb();

	raw.exec(`
    CREATE TABLE marketing_leads (
      id TEXT PRIMARY KEY, company_id TEXT, email TEXT, name TEXT,
      source TEXT, landing_page_slug TEXT,
      utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
      consent INTEGER DEFAULT 0,
      metadata_json TEXT DEFAULT '{}',
      status TEXT DEFAULT 'new',
      created_at TEXT, updated_at TEXT
    );
    CREATE UNIQUE INDEX uq_marketing_leads_company_email
      ON marketing_leads(company_id, email);

    CREATE TABLE marketing_campaigns (
      id TEXT PRIMARY KEY, company_id TEXT, name TEXT, subject TEXT,
      body_html TEXT, segment_status TEXT,
      status TEXT DEFAULT 'draft',
      scheduled_at TEXT, started_at TEXT, completed_at TEXT,
      sent_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0,
      created_by TEXT, created_at TEXT, updated_at TEXT
    );

    CREATE TABLE marketing_campaign_recipients (
      id TEXT PRIMARY KEY, campaign_id TEXT, lead_id TEXT,
      status TEXT DEFAULT 'pending',
      resend_message_id TEXT, error_message TEXT, sent_at TEXT
    );
    CREATE UNIQUE INDEX uq_marketing_recipients_campaign_lead
      ON marketing_campaign_recipients(campaign_id, lead_id);

    CREATE TABLE marketing_landing_pages (
      id TEXT PRIMARY KEY, company_id TEXT, slug TEXT,
      title TEXT, headline TEXT, subheadline TEXT,
      body_markdown TEXT, cta_label TEXT DEFAULT 'Get started',
      cta_url TEXT, capture_form INTEGER DEFAULT 1,
      published INTEGER DEFAULT 0, view_count INTEGER DEFAULT 0,
      created_at TEXT, updated_at TEXT
    );
    CREATE UNIQUE INDEX uq_marketing_landing_company_slug
      ON marketing_landing_pages(company_id, slug);
  `);

	repo = await import("../repositories/marketing.repo.js");
});

afterAll(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

beforeEach(() => {
	raw.exec(`DELETE FROM marketing_campaign_recipients;
            DELETE FROM marketing_campaigns;
            DELETE FROM marketing_leads;
            DELETE FROM marketing_landing_pages;`);
});

describe("marketing leads", () => {
	it("creates and lists leads", () => {
		const a = repo.upsertLead({
			companyId: "co1",
			email: "a@example.com",
			name: "Alice",
			source: "form",
		});
		expect(a.id).toBeTruthy();
		expect(a.email).toBe("a@example.com");
		expect(a.status).toBe("new");

		const list = repo.listLeads("co1");
		expect(list).toHaveLength(1);
		expect(list[0]?.email).toBe("a@example.com");
	});

	it("upsert merges metadata and lowercases email", () => {
		repo.upsertLead({
			companyId: "co1",
			email: "Bob@Example.com",
			metadata: { firstSeen: "page-a" },
		});
		const updated = repo.upsertLead({
			companyId: "co1",
			email: "bob@example.com",
			metadata: { lastClick: "cta" },
			consent: true,
		});
		expect(updated.email).toBe("bob@example.com");
		expect(updated.metadata).toMatchObject({
			firstSeen: "page-a",
			lastClick: "cta",
		});
		expect(updated.consent).toBe(true);
		expect(repo.listLeads("co1")).toHaveLength(1);
	});

	it("filters by status and isolates per company", () => {
		repo.upsertLead({ companyId: "co1", email: "a@x.com" });
		const b = repo.upsertLead({ companyId: "co1", email: "b@x.com" });
		repo.upsertLead({ companyId: "co2", email: "c@x.com" });
		repo.updateLead(b.id, "co1", { status: "qualified" });

		const co1All = repo.listLeads("co1");
		expect(co1All).toHaveLength(2);
		const qualified = repo.listLeads("co1", { status: "qualified" });
		expect(qualified.map((r) => r.email)).toEqual(["b@x.com"]);
		expect(repo.listLeads("co2")).toHaveLength(1);
	});

	it("delete removes only the matching scoped lead", () => {
		const lead = repo.upsertLead({ companyId: "co1", email: "del@x.com" });
		expect(repo.deleteLead(lead.id, "co2")).toBe(false);
		expect(repo.deleteLead(lead.id, "co1")).toBe(true);
		expect(repo.getLead(lead.id, "co1")).toBeNull();
	});
});

describe("marketing campaigns", () => {
	it("creates a campaign in draft and enqueues recipients", () => {
		const c = repo.createCampaign({
			companyId: "co1",
			name: "Spring Promo",
			subject: "Hi",
			bodyHtml: "<p>Hi</p>",
		});
		expect(c.status).toBe("draft");
		expect(c.sentCount).toBe(0);

		const a = repo.upsertLead({ companyId: "co1", email: "a@x.com" });
		const b = repo.upsertLead({ companyId: "co1", email: "b@x.com" });
		const inserted = repo.enqueueRecipients(c.id, [a.id, b.id]);
		expect(inserted).toBe(2);

		// Idempotent enqueue.
		expect(repo.enqueueRecipients(c.id, [a.id, b.id])).toBe(0);

		const pending = repo.listPendingRecipients(c.id);
		expect(pending).toHaveLength(2);
	});

	it("status transitions and counter increments are persisted", () => {
		const c = repo.createCampaign({
			companyId: "co1",
			name: "n",
			subject: "s",
			bodyHtml: "<p>x</p>",
		});
		repo.setCampaignStatus(c.id, "co1", "running", {
			startedAt: "2025-01-01T00:00:00Z",
		});
		repo.incCampaignCounters(c.id, { sent: 3, failed: 1 });
		repo.setCampaignStatus(c.id, "co1", "completed", {
			completedAt: "2025-01-02T00:00:00Z",
		});
		const reread = repo.getCampaign(c.id, "co1");
		expect(reread?.status).toBe("completed");
		expect(reread?.sentCount).toBe(3);
		expect(reread?.failedCount).toBe(1);
		expect(reread?.startedAt).toBe("2025-01-01T00:00:00Z");
		expect(reread?.completedAt).toBe("2025-01-02T00:00:00Z");
	});

	it("recipient mark-sent / mark-failed update the row", () => {
		const c = repo.createCampaign({
			companyId: "co1",
			name: "n",
			subject: "s",
			bodyHtml: "x",
		});
		const lead = repo.upsertLead({ companyId: "co1", email: "x@x.com" });
		repo.enqueueRecipients(c.id, [lead.id]);
		const [r] = repo.listPendingRecipients(c.id);
		if (!r) throw new Error("expected pending recipient");
		repo.markRecipientSent(r.id, "msg_123");
		const after = repo.listRecipients(c.id);
		expect(after[0]?.status).toBe("sent");
		expect(after[0]?.resendMessageId).toBe("msg_123");
	});
});

describe("marketing landing pages", () => {
	it("creates a published page and serves by slug", () => {
		const page = repo.createLandingPage({
			companyId: "co1",
			slug: "spring-2025",
			title: "Spring",
			headline: "Welcome",
			bodyMarkdown: "Hello world",
			published: true,
		});
		expect(page.published).toBe(true);
		expect(page.viewCount).toBe(0);

		const found = repo.getPublishedLandingBySlug("spring-2025");
		expect(found?.id).toBe(page.id);

		repo.incLandingViewCount(page.id);
		const reread = repo.getLandingPageById(page.id, "co1");
		expect(reread?.viewCount).toBe(1);
	});

	it("does not return unpublished pages by slug", () => {
		repo.createLandingPage({
			companyId: "co1",
			slug: "draft",
			title: "t",
			headline: "h",
			published: false,
		});
		expect(repo.getPublishedLandingBySlug("draft")).toBeNull();
	});

	it("update flips published and patches headline", () => {
		const page = repo.createLandingPage({
			companyId: "co1",
			slug: "promo",
			title: "t",
			headline: "h",
		});
		const updated = repo.updateLandingPage(page.id, "co1", {
			headline: "New head",
			published: true,
		});
		expect(updated?.headline).toBe("New head");
		expect(updated?.published).toBe(true);
	});

	it("rejects duplicate slug per company", () => {
		repo.createLandingPage({
			companyId: "co1",
			slug: "dup",
			title: "t",
			headline: "h",
		});
		expect(() =>
			repo.createLandingPage({
				companyId: "co1",
				slug: "dup",
				title: "t",
				headline: "h",
			}),
		).toThrow();
	});
});

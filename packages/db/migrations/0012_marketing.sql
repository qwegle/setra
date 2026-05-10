-- Marketing module: leads, campaigns, landing pages.
-- Powers the GTM surface used by marketing agents and the public landing page
-- renderer so Setra can capture, segment, and contact prospects without a
-- separate marketing-automation stack.

CREATE TABLE IF NOT EXISTS marketing_leads (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  source TEXT,
  landing_page_slug TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  consent INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_marketing_leads_company
  ON marketing_leads(company_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_leads_company_email
  ON marketing_leads(company_id, email);
CREATE INDEX IF NOT EXISTS idx_marketing_leads_status
  ON marketing_leads(company_id, status);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  segment_status TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_company
  ON marketing_campaigns(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketing_campaign_recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  resend_message_id TEXT,
  error_message TEXT,
  sent_at TEXT,
  FOREIGN KEY (campaign_id) REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES marketing_leads(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_recipients_campaign_lead
  ON marketing_campaign_recipients(campaign_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_marketing_recipients_status
  ON marketing_campaign_recipients(campaign_id, status);

CREATE TABLE IF NOT EXISTS marketing_landing_pages (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  headline TEXT NOT NULL,
  subheadline TEXT,
  body_markdown TEXT NOT NULL,
  cta_label TEXT NOT NULL DEFAULT 'Get started',
  cta_url TEXT,
  capture_form INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_landing_company_slug
  ON marketing_landing_pages(company_id, slug);
CREATE INDEX IF NOT EXISTS idx_marketing_landing_published
  ON marketing_landing_pages(published);

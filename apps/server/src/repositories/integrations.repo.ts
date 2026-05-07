/**
 * integrations.repo.ts — Repository for integrations and secrets
 */

import * as crypto from "node:crypto";
import { getRawDb } from "@setra/db";
import { decrypt, encrypt } from "../lib/crypto.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntegrationRow {
	id: string;
	type: string;
	name: string;
	status: string | null;
	config_json: string | null;
	company_id: string | null;
	created_at: string;
	updated_at: string | null;
}

export interface SecretRow {
	id: string;
	name: string;
	description: string | null;
	value_hint: string | null;
	encrypted_value?: string | null;
	company_id: string | null;
	created_at: string;
	updated_at: string | null;
}

let integrationsSchemaEnsured = false;

function parseConfigJson(
	raw: string | null | undefined,
): Record<string, string> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") return {};
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
			out[k] = typeof v === "string" ? v : String(v ?? "");
		}
		return out;
	} catch {
		return {};
	}
}

function hasColumn(table: string, column: string): boolean {
	const rows = getRawDb()
		.prepare(`PRAGMA table_info(${table})`)
		.all() as Array<{ name: string }>;
	return rows.some((r) => r.name === column);
}

function ensureIntegrationsSchema(): void {
	if (integrationsSchemaEnsured) return;
	const db = getRawDb();
	db.prepare(`
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'disconnected',
      config_json TEXT DEFAULT '{}',
      company_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT
    )
  `).run();
	db.prepare(`
    CREATE TABLE IF NOT EXISTS secrets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      value_hint TEXT,
      encrypted_value TEXT,
      company_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT
    )
  `).run();
	if (!hasColumn("secrets", "company_id")) {
		db.prepare("ALTER TABLE secrets ADD COLUMN company_id TEXT").run();
	}
	if (!hasColumn("secrets", "encrypted_value")) {
		try {
			db.prepare("ALTER TABLE secrets ADD COLUMN encrypted_value TEXT").run();
		} catch {
			// SQLite has no ALTER TABLE ... IF NOT EXISTS; ignore duplicate-column races.
		}
	}
	integrationsSchemaEnsured = true;
}

// ─── Integrations ─────────────────────────────────────────────────────────────

export function listIntegrations(companyId: string) {
	ensureIntegrationsSchema();
	const rows = getRawDb()
		.prepare(
			`SELECT * FROM integrations
        WHERE company_id = ?
        ORDER BY created_at DESC`,
		)
		.all(companyId);
	return (rows as IntegrationRow[]).map((r) => ({
		...r,
		config: parseConfigJson(r.config_json),
	}));
}

export function createIntegration(params: {
	type: string;
	name: string;
	config: Record<string, string>;
	companyId: string;
}) {
	ensureIntegrationsSchema();
	const id = crypto.randomUUID();
	getRawDb()
		.prepare(
			"INSERT INTO integrations (id, type, name, status, config_json, company_id) VALUES (?, ?, ?, 'active', ?, ?)",
		)
		.run(
			id,
			params.type,
			params.name,
			JSON.stringify(params.config),
			params.companyId,
		);
	const row = getRawDb()
		.prepare("SELECT * FROM integrations WHERE id = ?")
		.get(id) as IntegrationRow;
	return { ...row, config: parseConfigJson(row.config_json) };
}

export function updateIntegration(
	id: string,
	companyId: string,
	updates: { status?: string; config?: Record<string, string> },
) {
	ensureIntegrationsSchema();
	const now = new Date().toISOString();
	getRawDb()
		.prepare(
			"UPDATE integrations SET status = COALESCE(?, status), config_json = COALESCE(?, config_json), updated_at = ? WHERE id = ? AND company_id = ?",
		)
		.run(
			updates.status ?? null,
			updates.config ? JSON.stringify(updates.config) : null,
			now,
			id,
			companyId,
		);
	const row = getRawDb()
		.prepare("SELECT * FROM integrations WHERE id = ? AND company_id = ?")
		.get(id, companyId) as IntegrationRow | undefined;
	if (!row) return null;
	return { ...row, config: parseConfigJson(row.config_json) };
}

export function deleteIntegration(id: string, companyId: string): boolean {
	ensureIntegrationsSchema();
	const result = getRawDb()
		.prepare("DELETE FROM integrations WHERE id = ? AND company_id = ?")
		.run(id, companyId);
	return result.changes > 0;
}

// ─── Secrets ──────────────────────────────────────────────────────────────────

export function listSecrets(companyId: string) {
	ensureIntegrationsSchema();
	return getRawDb()
		.prepare(
			"SELECT id, name, description, value_hint, company_id, created_at, updated_at FROM secrets WHERE company_id = ? ORDER BY name",
		)
		.all(companyId) as SecretRow[];
}

export function createSecret(params: {
	name: string;
	description?: string;
	value?: string;
	companyId: string;
}) {
	ensureIntegrationsSchema();
	const id = crypto.randomUUID();
	const hint = params.value
		? `${params.value.slice(0, 4)}${"*".repeat(
				Math.max(0, Math.min(params.value.length - 4, 12)),
			)}`
		: null;
	const encrypted = params.value !== undefined ? encrypt(params.value) : null;
	getRawDb()
		.prepare(
			"INSERT INTO secrets (id, name, description, value_hint, encrypted_value, company_id) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.run(
			id,
			params.name,
			params.description ?? null,
			hint,
			encrypted,
			params.companyId,
		);
	return getRawDb()
		.prepare(
			"SELECT id, name, description, value_hint, company_id, created_at, updated_at FROM secrets WHERE id = ? AND company_id = ?",
		)
		.get(id, params.companyId) as SecretRow;
}

export function getSecretValue(id: string, companyId: string): string | null {
	ensureIntegrationsSchema();
	const row = getRawDb()
		.prepare(
			"SELECT encrypted_value FROM secrets WHERE id = ? AND company_id = ?",
		)
		.get(id, companyId) as { encrypted_value: string | null } | undefined;
	if (!row?.encrypted_value) return null;
	return decrypt(row.encrypted_value);
}

export function getSecretByName(
	name: string,
	companyId: string,
): string | null {
	ensureIntegrationsSchema();
	const row = getRawDb()
		.prepare(
			"SELECT encrypted_value FROM secrets WHERE name = ? AND company_id = ?",
		)
		.get(name, companyId) as { encrypted_value: string | null } | undefined;
	if (!row?.encrypted_value) return null;
	return decrypt(row.encrypted_value);
}

export function updateSecret(
	id: string,
	companyId: string,
	value: string,
): boolean {
	ensureIntegrationsSchema();
	const hint = value
		? `${value.slice(0, 4)}${"*".repeat(
				Math.max(0, Math.min(value.length - 4, 12)),
			)}`
		: null;
	const encrypted = encrypt(value);
	const result = getRawDb()
		.prepare(
			"UPDATE secrets SET encrypted_value = ?, value_hint = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?",
		)
		.run(encrypted, hint, id, companyId);
	return result.changes > 0;
}

export function deleteSecret(id: string, companyId: string): boolean {
	ensureIntegrationsSchema();
	const result = getRawDb()
		.prepare("DELETE FROM secrets WHERE id = ? AND company_id = ?")
		.run(id, companyId);
	return result.changes > 0;
}

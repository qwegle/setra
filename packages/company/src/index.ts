// @setra/company — public API
export * from "./types.js";
export * from "./schema.js";
export * from "./broker.js";
export * from "./launcher.js";
export * from "./mcp-tools.js";
export * from "./ui-spec.js";
export * from "./company-templates.js";
// Re-export existing template entries under distinct names to avoid collision
export {
	COMPANY_TEMPLATES as LEGACY_COMPANY_TEMPLATES,
	getTemplate as getLegacyTemplate,
	type CompanyTemplateEntry,
	TEMPLATE_SOLO_CODER,
	TEMPLATE_CODE_REVIEW,
	TEMPLATE_FEATURE_TEAM,
	TEMPLATE_SECURITY_AUDIT,
	TEMPLATE_DOCUMENTATION,
} from "./templates.js";

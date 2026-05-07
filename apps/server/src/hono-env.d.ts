declare module "hono" {
	interface ContextVariableMap {
		companyId: string;
		userId: string;
		userEmail: string;
		userRole: "owner" | "admin" | "member";
		authMode: "legacy" | "jwt";
	}
}

export {};

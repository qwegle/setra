export interface SecretStoreHooks {
	readSecret?: (
		companyId: string | null | undefined,
		key: string,
	) => string | undefined;
	writeSecret?: (
		companyId: string | null | undefined,
		key: string,
		value: string,
	) => void;
	deleteSecret?: (companyId: string | null | undefined, key: string) => void;
}

let registeredHooks: SecretStoreHooks | null = null;

export function registerSecretStoreHooks(hooks: SecretStoreHooks | null): void {
	registeredHooks = hooks;
}

export function readSecretFromHooks(
	companyId: string | null | undefined,
	key: string,
): string | undefined {
	return registeredHooks?.readSecret?.(companyId, key);
}

export function writeSecretToHooks(
	companyId: string | null | undefined,
	key: string,
	value: string,
): void {
	registeredHooks?.writeSecret?.(companyId, key, value);
}

export function deleteSecretFromHooks(
	companyId: string | null | undefined,
	key: string,
): void {
	registeredHooks?.deleteSecret?.(companyId, key);
}

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const savedEnv: Record<"HOME" | "INSTANCE_TOKEN", string | undefined> = {
	HOME: undefined,
	INSTANCE_TOKEN: undefined,
};
let homeDir: string;

async function loadCrypto() {
	vi.resetModules();
	return import("../crypto.js");
}

beforeEach(() => {
	savedEnv.HOME = process.env["HOME"];
	savedEnv.INSTANCE_TOKEN = process.env["INSTANCE_TOKEN"];
	homeDir = join(process.cwd(), ".vitest-artifacts", `crypto-${randomUUID()}`);
	mkdirSync(join(homeDir, ".setra"), { recursive: true });
	process.env["HOME"] = homeDir;
	delete process.env["INSTANCE_TOKEN"];
});

afterEach(() => {
	if (savedEnv.HOME === undefined) delete process.env["HOME"];
	else process.env["HOME"] = savedEnv.HOME;
	if (savedEnv.INSTANCE_TOKEN === undefined)
		delete process.env["INSTANCE_TOKEN"];
	else process.env["INSTANCE_TOKEN"] = savedEnv.INSTANCE_TOKEN;
	rmSync(homeDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("crypto", () => {
	it("round-trips plaintext through encrypt and decrypt", async () => {
		const { encrypt, decrypt } = await loadCrypto();
		const ciphertext = encrypt("server secret");

		expect(ciphertext).not.toBe("server secret");
		expect(decrypt(ciphertext)).toBe("server secret");
	});

	it("produces different ciphertexts for different plaintexts", async () => {
		const { encrypt } = await loadCrypto();

		expect(encrypt("alpha")).not.toBe(encrypt("beta"));
	});

	it("fails to decrypt a tampered ciphertext", async () => {
		const { encrypt, decrypt } = await loadCrypto();
		const encrypted = encrypt("do not alter");
		const [iv = "", ciphertext = "", tag = ""] = encrypted.split(":");
		const tamperedCiphertext = `${iv}:${ciphertext.replace(/^./, (char) =>
			char === "A" ? "B" : "A",
		)}:${tag}`;

		expect(() => decrypt(tamperedCiphertext)).toThrow();
	});

	it("handles empty strings", async () => {
		const { encrypt, decrypt } = await loadCrypto();

		expect(encrypt("")).toBe("");
		expect(decrypt("")).toBe("");
	});

	it("preserves unicode and special characters", async () => {
		const { encrypt, decrypt } = await loadCrypto();
		const plaintext = "こんにちは 🌍\nß∑≈ ç漢字 <> & %";

		expect(decrypt(encrypt(plaintext))).toBe(plaintext);
	});
});

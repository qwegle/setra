import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const KEY_FILE = join(homedir(), ".setra", "instance.key");
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function ensureKeyMaterial(): Buffer {
	const instanceToken = process.env.INSTANCE_TOKEN?.trim();
	if (instanceToken) {
		return Buffer.from(instanceToken, "utf8");
	}
	if (!existsSync(KEY_FILE)) {
		mkdirSync(dirname(KEY_FILE), { recursive: true });
		const generated = randomBytes(32).toString("base64");
		writeFileSync(KEY_FILE, generated, "utf8");
		try {
			chmodSync(dirname(KEY_FILE), 0o700);
		} catch {
			/* best-effort */
		}
		try {
			chmodSync(KEY_FILE, 0o600);
		} catch {
			/* best-effort */
		}
	}
	return Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "utf8");
}

function getKey(): Buffer {
	return scryptSync(ensureKeyMaterial(), "setra-instance-key", 32);
}

function isEncrypted(value: string): boolean {
	return value.split(":").length === 3;
}

export function encrypt(plaintext: string): string {
	if (plaintext.length === 0) return "";
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, getKey(), iv);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const tag = cipher.getAuthTag();
	return `${iv.toString("base64")}:${ciphertext.toString("base64")}:${tag.toString("base64")}`;
}

export function decrypt(encrypted: string): string {
	if (encrypted.length === 0 || !isEncrypted(encrypted)) return encrypted;
	const [ivRaw, ciphertextRaw, tagRaw] = encrypted.split(":");
	if (!ivRaw || !ciphertextRaw || !tagRaw) return encrypted;
	const decipher = createDecipheriv(
		ALGORITHM,
		getKey(),
		Buffer.from(ivRaw, "base64"),
	);
	decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
	const plaintext = Buffer.concat([
		decipher.update(Buffer.from(ciphertextRaw, "base64")),
		decipher.final(),
	]);
	return plaintext.toString("utf8");
}

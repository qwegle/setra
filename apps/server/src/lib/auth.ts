import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const JWT_SECRET =
	process.env.JWT_SECRET ??
	process.env.SETRA_INSTANCE_TOKEN ??
	process.env.INSTANCE_TOKEN ??
	crypto.randomBytes(32).toString("hex");

export interface TokenPayload {
	userId: string;
	email: string;
	companyId: string;
	role: "owner" | "admin" | "member";
	exp?: number;
}

function encode(data: string): string {
	return Buffer.from(data, "utf8").toString("base64url");
}

function decode(data: string): string {
	return Buffer.from(data, "base64url").toString("utf8");
}

export function generateToken(payload: TokenPayload): string {
	const body = JSON.stringify({
		...payload,
		exp: Date.now() + TOKEN_EXPIRY_MS,
	});
	const signature = crypto
		.createHmac("sha256", JWT_SECRET)
		.update(body)
		.digest("base64url");
	return `${encode(body)}.${signature}`;
}

export function verifyToken(token: string): TokenPayload {
	const [encoded, signature] = token.split(".");
	if (!encoded || !signature) throw new Error("Invalid token format");
	const body = decode(encoded);
	const expected = crypto
		.createHmac("sha256", JWT_SECRET)
		.update(body)
		.digest("base64url");
	const expectedBuf = Buffer.from(expected);
	const signatureBuf = Buffer.from(signature);
	if (
		expectedBuf.length !== signatureBuf.length ||
		!crypto.timingSafeEqual(expectedBuf, signatureBuf)
	) {
		throw new Error("Invalid token signature");
	}
	const payload = JSON.parse(body) as TokenPayload;
	if (
		!payload.userId ||
		!payload.email ||
		!payload.companyId ||
		!payload.role
	) {
		throw new Error("Invalid token payload");
	}
	return payload;
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.randomBytes(16).toString("hex");
	const buf = (await scryptAsync(password, salt, 64)) as Buffer;
	return `${salt}:${buf.toString("hex")}`;
}

export async function comparePassword(
	password: string,
	hash: string,
): Promise<boolean> {
	const [salt, storedHex] = hash.split(":");
	if (!salt || !storedHex) return false;
	const stored = Buffer.from(storedHex, "hex");
	const derived = (await scryptAsync(password, salt, stored.length)) as Buffer;
	return (
		stored.length === derived.length && crypto.timingSafeEqual(stored, derived)
	);
}

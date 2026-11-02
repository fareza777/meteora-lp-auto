import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { getConfig } from "./config";

const VAULT_VERSION = "v1";
const AAD_PREFIX = "tide:signer:";
const STRING_AAD_PREFIX = "tide:secret:";

function masterKey(): Buffer {
  const raw = getConfig().signerVaultKey;
  if (!raw) throw new Error("SIGNER_VAULT_KEY is not configured.");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // handled below
  }
  throw new Error("SIGNER_VAULT_KEY must be 32 bytes encoded as 64 hex characters or base64.");
}

function deriveUserKey(userId: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      masterKey(),
      Buffer.from("tide-lp-signer-salt-v1"),
      Buffer.from(`signer:${userId}`),
      32,
    ),
  );
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0 || a.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(a)) {
    return false;
  }
  try {
    const aa = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return aa.length === bb.length && timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

/**
 * Encrypts a 64-byte Solana secret key for server-side automatic signing.
 * The plaintext key exists only in process memory and is never returned by an API.
 */
export function encryptSignerSecret(secretKey: Uint8Array, userId: string): string {
  if (secretKey.length !== 64) throw new Error("Expected a 64-byte Solana secret key.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveUserKey(userId), iv);
  cipher.setAAD(Buffer.from(`${AAD_PREFIX}${userId}`));
  const ciphertext = Buffer.concat([cipher.update(secretKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VAULT_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(
    ".",
  );
}

export function decryptSignerSecret(payload: string, userId: string): Uint8Array {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== VAULT_VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Unsupported signer vault payload.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveUserKey(userId),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAAD(Buffer.from(`${AAD_PREFIX}${userId}`));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  if (plaintext.length !== 64) throw new Error("Signer vault payload is malformed.");
  return Uint8Array.from(plaintext);
}

export function encryptSensitiveString(value: string, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveUserKey(userId), iv);
  cipher.setAAD(Buffer.from(`${STRING_AAD_PREFIX}${userId}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VAULT_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(
    ".",
  );
}

export function decryptSensitiveString(payload: string, userId: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== VAULT_VERSION || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new Error("Unsupported encrypted payload.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveUserKey(userId),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAAD(Buffer.from(`${STRING_AAD_PREFIX}${userId}`));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function parseSolanaSecretKey(input: string): Uint8Array {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Secret key is empty.");

  if (trimmed.startsWith("[")) {
    let arr: unknown;
    try {
      arr = JSON.parse(trimmed);
    } catch {
      throw new Error("Secret key JSON is invalid.");
    }
    if (!Array.isArray(arr) || !arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      throw new Error("Secret key array must contain bytes 0–255.");
    }
    const bytes = Uint8Array.from(arr as number[]);
    if (bytes.length === 64) return bytes;
    if (bytes.length === 32) return Keypair.fromSeed(bytes).secretKey;
    throw new Error("Secret key array must contain 32 or 64 bytes.");
  }

  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(trimmed);
  } catch {
    throw new Error("Secret key must be base58 or a JSON byte array.");
  }
  if (bytes.length === 64) return bytes;
  if (bytes.length === 32) return Keypair.fromSeed(bytes).secretKey;
  throw new Error("Secret key must decode to 32 or 64 bytes.");
}

export function signerPublicKeyFromSecret(secretKey: Uint8Array): string {
  return Keypair.fromSecretKey(secretKey).publicKey.toBase58();
}

export function verifyWalletSignature(
  wallet: string,
  message: string,
  signatureBase58: string,
): boolean {
  try {
    const publicKey = new PublicKey(wallet);
    const signature = bs58.decode(signatureBase58);
    if (signature.length !== 64) return false;
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      signature,
      publicKey.toBytes(),
    );
  } catch {
    return false;
  }
}

export function isValidSolanaAddress(address: string): boolean {
  try {
    return new PublicKey(address).toBase58() === address;
  } catch {
    return false;
  }
}

export function redactAddress(address: string, front = 4, back = 4): string {
  if (address.length <= front + back + 3) return address;
  return `${address.slice(0, front)}…${address.slice(-back)}`;
}

/** Redacts secrets from arbitrary strings before they are persisted to logs. */
export function redactSecrets(text: string): string {
  return text
    .replace(/[1-9A-HJ-NP-Za-km-z]{80,90}/g, "[redacted-key]")
    .replace(/\b[0-9a-fA-F]{64}\b/g, "[redacted]")
    .replace(/(bot)?\d{8,12}:[A-Za-z0-9_-]{30,}/g, "[redacted-token]");
}

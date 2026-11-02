import { afterEach, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { resetConfigForTests, validateLiveRpc } from "@/lib/config";
import {
  constantTimeEqualHex,
  decryptSensitiveString,
  decryptSignerSecret,
  encryptSensitiveString,
  encryptSignerSecret,
  isValidSolanaAddress,
  parseSolanaSecretKey,
  redactAddress,
  redactSecrets,
  sha256,
  signerPublicKeyFromSecret,
  verifyWalletSignature,
} from "@/lib/security";

const ORIGINAL_RPC = process.env.SOLANA_RPC_URL;

afterEach(() => {
  process.env.SOLANA_RPC_URL = ORIGINAL_RPC;
  delete process.env.ALLOW_PUBLIC_RPC_LIVE;
  resetConfigForTests();
});

describe("signer vault", () => {
  it("round-trips a 64-byte secret key per user", () => {
    const keypair = Keypair.generate();
    const payload = encryptSignerSecret(keypair.secretKey, "user-a");
    expect(payload).not.toContain("secret");
    expect(payload.split(".")).toHaveLength(4);
    expect(Array.from(decryptSignerSecret(payload, "user-a"))).toEqual(Array.from(keypair.secretKey));
    expect(signerPublicKeyFromSecret(decryptSignerSecret(payload, "user-a"))).toBe(
      keypair.publicKey.toBase58(),
    );
  });

  it("uses a fresh IV for every encryption", () => {
    const keypair = Keypair.generate();
    const first = encryptSignerSecret(keypair.secretKey, "user-a");
    const second = encryptSignerSecret(keypair.secretKey, "user-a");
    expect(first).not.toBe(second);
  });

  it("rejects the wrong user, tampered ciphertext and malformed payloads", () => {
    const keypair = Keypair.generate();
    const payload = encryptSignerSecret(keypair.secretKey, "user-a");
    expect(() => decryptSignerSecret(payload, "user-b")).toThrow();

    const parts = payload.split(".");
    const bytes = Buffer.from(parts[3], "base64url");
    bytes[0] ^= 0xff;
    parts[3] = bytes.toString("base64url");
    expect(() => decryptSignerSecret(parts.join("."), "user-a")).toThrow();

    expect(() => decryptSignerSecret("v2.bad", "user-a")).toThrow("Unsupported signer vault payload.");
    expect(() => decryptSignerSecret("", "user-a")).toThrow();
  });

  it("rejects secrets that are not 64 bytes", () => {
    expect(() => encryptSignerSecret(new Uint8Array(32), "user-a")).toThrow(
      "Expected a 64-byte Solana secret key.",
    );
  });
});

describe("encrypted settings values", () => {
  it("round-trips strings including empty values", () => {
    const secret = "123456789:AAH-test-token-with-length";
    const payload = encryptSensitiveString(secret, "user-a");
    expect(decryptSensitiveString(payload, "user-a")).toBe(secret);
    expect(decryptSensitiveString(encryptSensitiveString("", "user-a"), "user-a")).toBe("");
    expect(() => decryptSensitiveString(payload, "user-b")).toThrow();
  });
});

describe("parseSolanaSecretKey", () => {
  it("accepts base58 and JSON byte arrays", () => {
    const keypair = Keypair.generate();
    expect(Array.from(parseSolanaSecretKey(bs58.encode(keypair.secretKey)))).toEqual(
      Array.from(keypair.secretKey),
    );
    expect(Array.from(parseSolanaSecretKey(JSON.stringify(Array.from(keypair.secretKey))))).toEqual(
      Array.from(keypair.secretKey),
    );
    expect(Array.from(parseSolanaSecretKey(JSON.stringify(Array.from(keypair.secretKey.slice(0, 32)))))).toEqual(
      Array.from(keypair.secretKey),
    );
    expect(Array.from(parseSolanaSecretKey(bs58.encode(keypair.secretKey.slice(0, 32))))).toEqual(
      Array.from(keypair.secretKey),
    );
    expect(Array.from(parseSolanaSecretKey(`  ${bs58.encode(keypair.secretKey)}  `))).toEqual(
      Array.from(keypair.secretKey),
    );
  });

  it("rejects garbage and wrong lengths", () => {
    expect(() => parseSolanaSecretKey("")).toThrow("Secret key is empty.");
    expect(() => parseSolanaSecretKey("0OIl")).toThrow("Secret key must be base58 or a JSON byte array.");
    expect(() => parseSolanaSecretKey("[1,2,3]")).toThrow("Secret key array must contain 32 or 64 bytes.");
    expect(() => parseSolanaSecretKey("[300]")).toThrow("Secret key array must contain bytes 0–255.");
    expect(() => parseSolanaSecretKey("[not json")).toThrow("Secret key JSON is invalid.");
  });
});

describe("wallet signatures", () => {
  it("verifies an ed25519 signature over the exact message", () => {
    const keypair = Keypair.generate();
    const message = "Sign in to Tide\nNonce: abc";
    const signature = bs58.encode(nacl.sign.detached(Buffer.from(message, "utf8"), keypair.secretKey));
    expect(verifyWalletSignature(keypair.publicKey.toBase58(), message, signature)).toBe(true);
    expect(verifyWalletSignature(keypair.publicKey.toBase58(), `${message}!`, signature)).toBe(false);
    expect(verifyWalletSignature(keypair.publicKey.toBase58(), message, bs58.encode(new Uint8Array(64)))).toBe(
      false,
    );
    expect(verifyWalletSignature("not-a-wallet", message, signature)).toBe(false);
  });

  it("validates base58 Solana addresses", () => {
    expect(isValidSolanaAddress(Keypair.generate().publicKey.toBase58())).toBe(true);
    expect(isValidSolanaAddress("not-a-wallet")).toBe(false);
    expect(isValidSolanaAddress("")).toBe(false);
  });
});

describe("redaction", () => {
  it("redacts keys, hashes and bot tokens from logs", () => {
    expect(redactSecrets(`key ${"5".repeat(88)} end`)).toBe("key [redacted-key] end");
    expect(redactSecrets(`hash ${"a".repeat(64)}`)).toBe("hash [redacted]");
    expect(redactSecrets(`token ${"123456789:"}${"A".repeat(35)}`)).toBe("token [redacted-token]");
    expect(redactSecrets("Opened Spot LP in SOL-USDC with $2500")).toBe(
      "Opened Spot LP in SOL-USDC with $2500",
    );
  });

  it("shortens addresses and compares digests safely", () => {
    expect(redactAddress("So11111111111111111111111111111111111111112")).toBe("So11…1112");
    expect(redactAddress("short")).toBe("short");
    expect(constantTimeEqualHex(sha256("a"), sha256("a"))).toBe(true);
    expect(constantTimeEqualHex(sha256("a"), sha256("b"))).toBe(false);
    expect(constantTimeEqualHex("zz", "zz")).toBe(false);
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("live RPC gate", () => {
  it("rejects the public mainnet RPC for automatic signing", () => {
    const check = validateLiveRpc();
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/dedicated Solana RPC/i);
  });

  it("allows a dedicated RPC", () => {
    process.env.SOLANA_RPC_URL = "https://tide-rpc.example.com";
    resetConfigForTests();
    expect(validateLiveRpc()).toEqual({ ok: true });
  });

  it("can explicitly allow a public RPC only when configured", () => {
    process.env.ALLOW_PUBLIC_RPC_LIVE = "true";
    resetConfigForTests();
    expect(validateLiveRpc().ok).toBe(true);
  });
});

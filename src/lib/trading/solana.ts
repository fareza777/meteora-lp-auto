import "server-only";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { getConfig } from "../config";
import { cached } from "../market/cache";
import { decryptSignerSecret } from "../security";
import { getEncryptedExecutionSecret, getExecutionWallet } from "../store";
import type { WalletSnapshot, WalletTokenBalance } from "../types";

const SOL_MINT = NATIVE_MINT.toBase58();
const KNOWN_SYMBOLS: Record<string, string> = {
  [SOL_MINT]: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB: "USD1",
  USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA: "USDS",
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "JitoSOL",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "mSOL",
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: "bSOL",
};
const QUOTE_SYMBOLS = new Set(["USDC", "USDT", "USD1", "USDS", "SOL", "JITOSOL", "MSOL", "BSOL"]);

interface JupiterPriceEntry {
  usdPrice?: number;
  decimals?: number;
}

interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct?: string;
  swapTransaction?: string;
}

export interface SendResult {
  signature: string;
  feeLamports: number;
}

export class LiveError extends Error {}

export function getConnection(): Connection {
  const config = getConfig();
  return new Connection(config.rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
    disableRetryOnRateLimit: false,
  });
}

export function loadExecutionSigner(userId: string): Keypair {
  const wallet = getExecutionWallet(userId);
  const encrypted = getEncryptedExecutionSecret(userId);
  if (!wallet || !encrypted) {
    throw new LiveError("No execution wallet is configured.");
  }
  const secret = decryptSignerSecret(encrypted, userId);
  const signer = Keypair.fromSecretKey(secret);
  if (signer.publicKey.toBase58() !== wallet.pubkey) {
    throw new LiveError("Execution wallet integrity check failed.");
  }
  return signer;
}

function simulateError(value: { err: unknown; logs?: string[] | null }): string {
  const logs = (value.logs ?? []).filter(Boolean).slice(-4).join(" | ");
  return `Transaction simulation failed${logs ? `: ${logs}` : ""}`;
}

export async function signAndSend(
  connection: Connection,
  transaction: Transaction | VersionedTransaction,
  signers: Keypair[],
  label = "transaction",
): Promise<SendResult> {
  if (transaction instanceof VersionedTransaction) {
    const sim = await connection.simulateTransaction(transaction);
    if (sim.value.err) throw new LiveError(simulateError(sim.value));
    transaction.sign(signers);
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    await confirmSignature(connection, signature);
    return { signature, feeLamports: await readFee(connection, signature) };
  }

  if (!transaction.feePayer) transaction.feePayer = signers[0].publicKey;
  if (!transaction.recentBlockhash) {
    const latest = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = latest.blockhash;
  }
  const blockhash = transaction.recentBlockhash!;
  const sim = await connection.simulateTransaction(transaction);
  if (sim.value.err) throw new LiveError(`${label}: ${simulateError(sim.value)}`);
  transaction.sign(...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });
  await confirmSignature(connection, signature);
  return { signature, feeLamports: await readFee(connection, signature) };
}

async function confirmSignature(connection: Connection, signature: string): Promise<void> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const result = await connection.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  if (result.value.err) throw new LiveError(`Transaction failed on-chain: ${JSON.stringify(result.value.err)}`);
}

async function readFee(connection: Connection, signature: string): Promise<number> {
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    return tx?.meta?.fee ?? 5_000;
  } catch {
    return 5_000;
  }
}

export async function getJupiterPrices(mints: string[]): Promise<Record<string, JupiterPriceEntry>> {
  const unique = Array.from(new Set(mints.filter(Boolean))).sort();
  if (!unique.length) return {};
  const map: Record<string, JupiterPriceEntry> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 50) chunks.push(unique.slice(i, i + 50));
  await Promise.all(
    chunks.map(async (chunk) => {
      const key = `jup-price:${chunk.join(",")}`;
      try {
        const result = await cached<Record<string, JupiterPriceEntry>>(key, 60_000, 10 * 60_000, async () => {
          const response = await fetch(`${getConfig().jupiterApi}/price/v3?ids=${chunk.join(",")}`, {
            headers: { Accept: "application/json" },
            cache: "no-store",
            signal: AbortSignal.timeout(8_000),
          });
          if (!response.ok) throw new Error(`Jupiter price API returned HTTP ${response.status}`);
          return (await response.json()) as Record<string, JupiterPriceEntry>;
        });
        Object.assign(map, result.value);
      } catch {
        // Prices are best-effort; wallet balances remain visible without them.
      }
    }),
  );
  return map;
}

async function tokenAccountsFor(connection: Connection, owner: PublicKey, programId: PublicKey) {
  try {
    const result = await connection.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed");
    return result.value.map((entry) => {
      const parsed = entry.account.data as {
        parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number; uiAmount?: number } } };
      };
      const info = parsed.parsed?.info;
      const amount = info?.tokenAmount;
      return {
        mint: info?.mint ?? "",
        raw: amount?.amount ?? "0",
        decimals: amount?.decimals ?? 0,
        uiAmount: amount?.uiAmount ?? Number(amount?.amount ?? 0) / 10 ** (amount?.decimals ?? 0),
      };
    });
  } catch {
    return [];
  }
}

export async function getWalletSnapshot(userId: string, force = false): Promise<WalletSnapshot | null> {
  const wallet = getExecutionWallet(userId);
  if (!wallet) return null;
  const cacheKey = `wallet:${wallet.pubkey}`;
  if (force) {
    const loaded = await loadWalletSnapshot(wallet.pubkey);
    return loaded;
  }
  try {
    const result = await cached<WalletSnapshot>(cacheKey, 25_000, 5 * 60_000, () =>
      loadWalletSnapshot(wallet.pubkey),
    );
    return result.value;
  } catch (error) {
    return {
      address: wallet.pubkey,
      solBalance: 0,
      solPriceUsd: 0,
      tokens: [],
      totalValueUsd: 0,
      fetchedAt: Date.now(),
      error: error instanceof Error ? error.message : "Wallet data is unavailable.",
    };
  }
}

async function loadWalletSnapshot(address: string): Promise<WalletSnapshot> {
  const connection = getConnection();
  const owner = new PublicKey(address);
  const [lamports, spl, token2022] = await Promise.all([
    connection.getBalance(owner, "confirmed"),
    tokenAccountsFor(connection, owner, TOKEN_PROGRAM_ID),
    tokenAccountsFor(connection, owner, TOKEN_2022_PROGRAM_ID),
  ]);
  const all = [...spl, ...token2022].filter((token) => token.mint && Number(token.raw) > 0);
  const prices = await getJupiterPrices([SOL_MINT, ...all.map((token) => token.mint)]);
  const solPrice = prices[SOL_MINT]?.usdPrice ?? 0;
  const tokens: WalletTokenBalance[] = all
    .map((token) => {
      const symbol = KNOWN_SYMBOLS[token.mint] ?? `${token.mint.slice(0, 4)}…${token.mint.slice(-4)}`;
      const priceUsd = prices[token.mint]?.usdPrice ?? 0;
      return {
        mint: token.mint,
        symbol,
        decimals: token.decimals,
        amount: token.uiAmount,
        priceUsd,
        valueUsd: token.uiAmount * priceUsd,
        isQuote: QUOTE_SYMBOLS.has(symbol.toUpperCase()),
      };
    })
    .filter((token) => token.amount > 0)
    .sort((a, b) => b.valueUsd - a.valueUsd);
  const solBalance = lamports / LAMPORTS_PER_SOL;
  const totalValueUsd = solBalance * solPrice + tokens.reduce((sum, token) => sum + token.valueUsd, 0);
  return {
    address,
    solBalance,
    solPriceUsd: solPrice,
    tokens,
    totalValueUsd,
    fetchedAt: Date.now(),
    error: null,
  };
}

export interface SpendableTokenAccount {
  mint: string;
  tokenAccount: PublicKey;
  programId: PublicKey;
  raw: bigint;
  decimals: number;
}

export async function listSpendableTokenAccounts(owner: PublicKey): Promise<SpendableTokenAccount[]> {
  const connection = getConnection();
  const accounts: SpendableTokenAccount[] = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const result = await connection.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed");
      for (const entry of result.value) {
        const parsed = entry.account.data as {
          parsed?: {
            info?: {
              mint?: string;
              state?: string;
              tokenAmount?: { amount?: string; decimals?: number };
            };
          };
        };
        const info = parsed.parsed?.info;
        const raw = BigInt(info?.tokenAmount?.amount ?? "0");
        if (!info?.mint || raw <= 0n || info.state !== "initialized") continue;
        accounts.push({
          mint: info.mint,
          tokenAccount: entry.pubkey,
          programId,
          raw,
          decimals: info.tokenAmount?.decimals ?? 0,
        });
      }
    } catch {
      // A flaky token program must not hide balances from the other program.
    }
  }
  return accounts;
}

export async function getRawTokenBalance(owner: PublicKey, mint: PublicKey): Promise<bigint> {
  const connection = getConnection();
  const programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
  for (const programId of programs) {
    try {
      const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint, programId }, "confirmed");
      let total = 0n;
      for (const entry of accounts.value) {
        const parsed = entry.account.data as {
          parsed?: { info?: { tokenAmount?: { amount?: string } } };
        };
        total += BigInt(parsed.parsed?.info?.tokenAmount?.amount ?? "0");
      }
      if (total > 0n) return total;
    } catch {
      // Try the next token program.
    }
  }
  return 0n;
}

export async function ensureWrappedSol(connection: Connection, signer: Keypair, requiredLamports: number): Promise<void> {
  if (requiredLamports <= 0) return;
  const owner = signer.publicKey;
  const ata = getAssociatedTokenAddressSync(NATIVE_MINT, owner, false, TOKEN_PROGRAM_ID);
  const existing = await getRawTokenBalance(owner, NATIVE_MINT);
  const deficit = BigInt(requiredLamports) - existing;
  if (deficit <= 0n) return;
  const native = BigInt(await connection.getBalance(owner, "confirmed"));
  const reserve = BigInt(Math.floor(0.01 * LAMPORTS_PER_SOL));
  if (native - reserve < deficit) {
    throw new LiveError("Not enough SOL to wrap for this transaction.");
  }
  const tx = new Transaction();
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, NATIVE_MINT, TOKEN_PROGRAM_ID),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: ata, lamports: Number(deficit) }),
    createSyncNativeInstruction(ata, TOKEN_PROGRAM_ID),
  );
  await signAndSend(connection, tx, [signer], "wrap SOL");
}

export interface SwapResult extends SendResult {
  outAmountRaw: string;
  priceImpactPct: number;
}

export async function jupiterSwap(input: {
  signer: Keypair;
  inputMint: string;
  outputMint: string;
  amountRaw: bigint;
  slippageBps: number;
  maxPriceImpactPct: number;
}): Promise<SwapResult> {
  const { signer, inputMint, outputMint, amountRaw, slippageBps, maxPriceImpactPct } = input;
  if (amountRaw <= 0n) throw new LiveError("Swap amount is zero.");
  const connection = getConnection();
  const owner = signer.publicKey;

  if (inputMint === SOL_MINT) {
    const balance = await connection.getBalance(owner, "confirmed");
    const reserve = Math.floor(0.02 * LAMPORTS_PER_SOL);
    if (BigInt(balance) < amountRaw + BigInt(reserve)) {
      throw new LiveError("Not enough SOL for swap plus fee reserve.");
    }
    await ensureWrappedSol(connection, signer, Number(amountRaw));
  }

  const quoteParams = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountRaw.toString(),
    slippageBps: String(slippageBps),
    swapMode: "ExactIn",
    restrictIntermediateTokens: "true",
  });
  const quoteResponse = await fetch(`${getConfig().jupiterApi}/swap/v1/quote?${quoteParams.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!quoteResponse.ok) {
    const text = await quoteResponse.text().catch(() => "");
    throw new LiveError(`Jupiter quote failed (HTTP ${quoteResponse.status})${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
  const quote = (await quoteResponse.json()) as JupiterQuote;
  const priceImpact = Number(quote.priceImpactPct ?? 0) * 100;
  if (Number.isFinite(priceImpact) && priceImpact > maxPriceImpactPct) {
    throw new LiveError(`Price impact ${priceImpact.toFixed(2)}% exceeds the ${maxPriceImpactPct}% limit.`);
  }

  const swapResponse = await fetch(`${getConfig().jupiterApi}/swap/v1/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: owner.toBase58(),
      wrapAndUnwrapSol: false,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 100_000,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!swapResponse.ok) {
    const text = await swapResponse.text().catch(() => "");
    throw new LiveError(`Jupiter swap build failed (HTTP ${swapResponse.status})${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
  const swapBody = (await swapResponse.json()) as { swapTransaction?: string };
  if (!swapBody.swapTransaction) throw new LiveError("Jupiter did not return a swap transaction.");
  const transaction = VersionedTransaction.deserialize(Buffer.from(swapBody.swapTransaction, "base64"));
  const sent = await signAndSend(connection, transaction, [signer], "Jupiter swap");
  return {
    ...sent,
    outAmountRaw: quote.outAmount,
    priceImpactPct: priceImpact,
  };
}

export function toRawAmount(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const fixed = Math.floor(amount * 10 ** decimals);
  return BigInt(fixed);
}

export function fromRawAmount(raw: bigint | string, decimals: number): number {
  try {
    return Number(BigInt(raw)) / 10 ** decimals;
  } catch {
    return 0;
  }
}

export function knownSymbol(mint: string): string {
  return KNOWN_SYMBOLS[mint] ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

export { SOL_MINT };

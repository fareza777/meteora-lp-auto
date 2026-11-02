import "server-only";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import { withLock } from "../concurrency";
import { entrySides, estimatePaperFeeDailyPct } from "../analytics/lpMath";
import { eligibilityFailures } from "../analytics/strategy";
import { getConfig, validateLiveRpc } from "../config";
import { getDb, nowMs } from "../db";
import { getUserById, hasValidLiveArming, isKillSwitchActive } from "../auth";
import { getPoolDetail } from "../market/meteora";
import { economicPrice, economicRange, getPoolOrientation } from "../market/orientation";
import { notifyUser } from "../notifications";
import { encryptSignerSecret, signerPublicKeyFromSecret } from "../security";
import {
  countOpenLivePositions,
  getExecutionWallet,
  getBot,
  getOpenPositionsForPool,
  getPosition,
  getPositions,
  getUserSettings,
  insertPosition,
  liveNotionalSince,
  logActivity,
  recordTransaction,
  removeExecutionWallet,
  storeExecutionWallet,
  updatePosition,
} from "../store";
import type {
  BotRecord,
  ExecutionWalletRecord,
  LiveReadiness,
  PoolAnalysis,
  PoolSnapshot,
  PositionRecord,
  StrategyName,
  TradingMode,
} from "../types";
import {
  SOL_MINT,
  LiveError,
  ensureWrappedSol,
  fromRawAmount,
  getConnection,
  getJupiterPrices,
  getRawTokenBalance,
  getWalletSnapshot,
  jupiterSwap,
  listSpendableTokenAccounts,
  loadExecutionSigner,
  signAndSend,
  toRawAmount,
} from "./solana";

const MIN_LIVE_SOL_RESERVE = 0.12;
const MIN_LIVE_POSITION_USD = 10;
const MAX_BINS_PER_TX = 34;
const WITHDRAW_SOL_RESERVE = 0.005;
const WITHDRAW_TRANSFERS_PER_TX = 8;
const TOKEN_ACCOUNT_RENT_SPACE = 256;

export { LiveError };

interface LiveContext {
  wallet: ExecutionWalletRecord;
  signer: Keypair;
  reason?: undefined;
}

export function getLiveReadiness(userId: string): LiveReadiness {
  const config = getConfig();
  const wallet = getExecutionWallet(userId);
  const rpc = validateLiveRpc();
  const armedUntil = getArmedUntil(userId);
  const armed = hasValidLiveArming(userId);
  const killSwitch = isKillSwitchActive(userId);
  let reason: string | null = null;
  if (!config.liveGloballyEnabled) reason = "Live trading is disabled on this server.";
  else if (!rpc.ok) reason = rpc.reason ?? "Live RPC is not ready.";
  else if (killSwitch) reason = "Kill switch is active.";
  else if (!wallet) reason = "Create an execution wallet to enable live trading.";
  else if (!armed) reason = "Live trading is not armed for this session.";
  return {
    globallyEnabled: config.liveGloballyEnabled,
    rpcReady: rpc.ok,
    rpcReason: rpc.reason ?? null,
    armedUntil,
    armed,
    killSwitch,
    wallet,
    canTrade: reason === null,
    reason,
  };
}

function getArmedUntil(userId: string): number | null {
  const row = getDb()
    .prepare("SELECT live_armed_until FROM users WHERE id = ?")
    .get(userId) as { live_armed_until: number | null } | undefined;
  const value = row?.live_armed_until ?? null;
  return value && value > nowMs() ? value : null;
}

function liveContext(userId: string, opts: { requireArming: boolean }): LiveContext {
  const config = getConfig();
  if (!config.liveGloballyEnabled) throw new LiveError("Live trading is disabled on this server.");
  const rpc = validateLiveRpc();
  if (!rpc.ok) throw new LiveError(rpc.reason ?? "A dedicated live RPC is required.");
  const wallet = getExecutionWallet(userId);
  if (!wallet) throw new LiveError("Create an execution wallet first.");
  if (opts.requireArming) {
    if (isKillSwitchActive(userId)) throw new LiveError("Kill switch is active. Re-enable live trading in settings.");
    if (!hasValidLiveArming(userId)) throw new LiveError("Live trading is not armed. Sign the 24-hour arming message.");
  }
  return { wallet, signer: loadExecutionSigner(userId) };
}

export function createExecutionWallet(userId: string): ExecutionWalletRecord {
  if (getExecutionWallet(userId)) {
    throw new LiveError("An execution wallet already exists. Rotate it from settings if necessary.");
  }
  const signer = Keypair.generate();
  const encrypted = encryptSignerSecret(signer.secretKey, userId);
  const wallet = storeExecutionWallet(userId, signerPublicKeyFromSecret(signer.secretKey), encrypted);
  logActivity({
    userId,
    level: "warning",
    category: "live",
    message: `Execution wallet created: ${wallet.pubkey}. The private key is encrypted server-side and cannot be exported.`,
  });
  return wallet;
}

export function removeExecutionWalletSafely(userId: string): void {
  if (countOpenLivePositions(userId) > 0) {
    throw new LiveError("Close all live positions before removing the execution wallet.");
  }
  removeExecutionWallet(userId);
  logActivity({
    userId,
    level: "warning",
    category: "live",
    message: "Execution wallet removed from Tide.",
  });
}

export interface WithdrawResult {
  destination: string;
  signatures: string[];
  tokenAccounts: number;
  solLamports: number;
  failed: string[];
}

/**
 * Recovery path: sweeps every token and the native SOL balance from the
 * execution wallet to the wallet that owns this account. It deliberately skips
 * the live-mode gates so funds can be recovered while live is disabled, but the
 * destination is pinned to the authenticated wallet so a stolen session cannot
 * redirect the funds.
 */
export async function withdrawExecutionFunds(input: {
  userId: string;
  destination: string;
}): Promise<WithdrawResult> {
  return withLock(`portfolio:${input.userId}`, async () => {
    const user = getUserById(input.userId);
    if (!user) throw new LiveError("Unknown account.");
    if (input.destination !== user.authWallet) {
      throw new LiveError("Withdrawals can only be sent to the wallet you signed in with.");
    }
    const wallet = getExecutionWallet(input.userId);
    if (!wallet) throw new LiveError("Create an execution wallet first.");
    if (countOpenLivePositions(input.userId) > 0) {
      throw new LiveError("Close all live positions before withdrawing funds.");
    }
    const destination = new PublicKey(input.destination);
    const signer = loadExecutionSigner(input.userId);
    const owner = signer.publicKey;
    if (destination.equals(owner)) throw new LiveError("The execution wallet is already your signed-in wallet.");

    const connection = getConnection();
    const tokenAccounts = await listSpendableTokenAccounts(owner);
    const nativeLamports = await connection.getBalance(owner, "confirmed");
    const reserveLamports = Math.ceil(WITHDRAW_SOL_RESERVE * LAMPORTS_PER_SOL);
    const hasNative = nativeLamports > reserveLamports + 5_000;
    if (!tokenAccounts.length && !hasNative) {
      throw new LiveError("There is nothing to withdraw from the execution wallet.");
    }

    const transferable = tokenAccounts.filter((token) => token.mint !== SOL_MINT);
    const destinationAtas = new Map<string, PublicKey>();
    for (const token of transferable) {
      const ata = getAssociatedTokenAddressSync(
        new PublicKey(token.mint),
        destination,
        false,
        token.programId,
      );
      destinationAtas.set(ata.toBase58(), ata);
    }
    const ataInfos = destinationAtas.size
      ? await connection.getMultipleAccountsInfo([...destinationAtas.values()], "confirmed")
      : [];
    const missingAtas = ataInfos.filter((info) => info === null).length;
    const ataRent = missingAtas
      ? await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_RENT_SPACE, "confirmed")
      : 0;
    const chunkCount = Math.ceil(tokenAccounts.length / WITHDRAW_TRANSFERS_PER_TX);
    const requiredLamports =
      missingAtas * ataRent + (chunkCount + 1) * 10_000 + reserveLamports;
    if (nativeLamports < requiredLamports) {
      throw new LiveError(
        `The execution wallet needs about ${(requiredLamports / LAMPORTS_PER_SOL).toFixed(3)} SOL to cover account rent and fees for this withdrawal.`,
      );
    }

    let snapshotValueUsd = 0;
    let solPriceUsd = 0;
    try {
      const snapshot = await getWalletSnapshot(input.userId, true);
      snapshotValueUsd = snapshot?.totalValueUsd ?? 0;
      solPriceUsd = snapshot?.solPriceUsd ?? 0;
    } catch {
      // The withdrawal itself must not depend on price data.
    }

    const signatures: string[] = [];
    const failed: string[] = [];
    let feeLamports = 0;
    let sweptTokens = 0;

    async function sendTokenBatch(batch: typeof tokenAccounts): Promise<boolean> {
      const transaction = new Transaction();
      for (const token of batch) {
        if (token.mint === SOL_MINT) {
          transaction.add(
            createCloseAccountInstruction(token.tokenAccount, destination, owner, [], token.programId),
          );
          continue;
        }
        const mint = new PublicKey(token.mint);
        const ata = getAssociatedTokenAddressSync(mint, destination, false, token.programId);
        transaction.add(
          createAssociatedTokenAccountIdempotentInstruction(
            owner,
            ata,
            destination,
            mint,
            token.programId,
          ),
          createTransferInstruction(token.tokenAccount, ata, owner, token.raw, [], token.programId),
        );
      }
      try {
        const sent = await signAndSend(connection, transaction, [signer], "withdrawal");
        signatures.push(sent.signature);
        feeLamports += sent.feeLamports;
        sweptTokens += batch.length;
        return true;
      } catch (error) {
        if (batch.length === 1) {
          const token = batch[0];
          failed.push(
            `${token.mint.slice(0, 4)}…${token.mint.slice(-4)}: ${error instanceof Error ? error.message : "transfer failed"}`,
          );
        }
        return false;
      }
    }

    if (tokenAccounts.length) {
      const batches: (typeof tokenAccounts)[] = [];
      for (let start = 0; start < tokenAccounts.length; start += WITHDRAW_TRANSFERS_PER_TX) {
        batches.push(tokenAccounts.slice(start, start + WITHDRAW_TRANSFERS_PER_TX));
      }
      for (const batch of batches) {
        const sent = await sendTokenBatch(batch);
        if (sent || batch.length === 1) continue;
        for (const token of batch) {
          await sendTokenBatch([token]);
        }
      }
    }

    let solLamports = 0;
    const remaining = await connection.getBalance(owner, "confirmed");
    if (remaining > reserveLamports + 5_000) {
      solLamports = remaining - reserveLamports;
      try {
        const sent = await signAndSend(
          connection,
          new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: owner,
              toPubkey: destination,
              lamports: solLamports,
            }),
          ),
          [signer],
          "SOL withdrawal",
        );
        signatures.push(sent.signature);
        feeLamports += sent.feeLamports;
      } catch (error) {
        solLamports = 0;
        failed.push(`SOL: ${error instanceof Error ? error.message : "transfer failed"}`);
      }
    }

    if (!signatures.length) {
      throw new LiveError(failed[0] ?? "No funds could be withdrawn.");
    }

    recordTransaction({
      userId: input.userId,
      botId: null,
      positionId: null,
      mode: "live",
      type: "withdraw",
      status: "confirmed",
      signature: signatures[signatures.length - 1],
      amountUsd: snapshotValueUsd,
      networkFeeUsd: (feeLamports / LAMPORTS_PER_SOL) * (solPriceUsd || 0),
      poolName: null,
      metadata: {
        destination: input.destination,
        signatures,
        tokenAccounts: sweptTokens,
        solLamports,
        failed,
      },
    });
    logActivity({
      userId: input.userId,
      level: failed.length ? "warning" : "success",
      category: "live",
      message: `Withdrew ${sweptTokens} token balance${sweptTokens === 1 ? "" : "s"} and ${(solLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL to the signed-in wallet`,
      metadata: { signatures, failed },
    });
    void notifyUser(
      input.userId,
      "summary",
      `Tide live withdrawal\nTo: ${input.destination}\nSOL: ${(solLamports / LAMPORTS_PER_SOL).toFixed(4)}\nToken balances: ${sweptTokens}${failed.length ? `\nSkipped: ${failed.length}` : ""}`,
    );
    return {
      destination: input.destination,
      signatures,
      tokenAccounts: sweptTokens,
      solLamports,
      failed,
    };
  });
}

function resolveStrategyName(
  bot: BotRecord,
  analysis: PoolAnalysis,
  override?: StrategyName,
): StrategyName {
  if (bot.config.strategy === "auto" && override) return override;
  if (bot.config.strategy === "auto") return analysis.recommendedStrategy;
  if (bot.config.strategy === "curve") return "Curve";
  if (bot.config.strategy === "bidask") return "BidAsk";
  return "Spot";
}

function strategyEnum(name: StrategyName, sdk: typeof import("@meteora-ag/dlmm")): number {
  if (name === "Curve") return sdk.StrategyType.Curve;
  if (name === "BidAsk") return sdk.StrategyType.BidAsk;
  return sdk.StrategyType.Spot;
}

interface OrientationAmounts {
  baseAmount: number;
  quoteAmount: number;
  targetBaseRaw: bigint;
  targetQuoteRaw: bigint;
}

function orientationAmounts(pool: PoolSnapshot, capitalUsd: number, widthPct: number): OrientationAmounts {
  const orientation = getPoolOrientation(pool);
  if (!orientation) throw new LiveError("This pool has no recognised USD quote asset.");
  const bounds = economicRange(
    pool.currentPrice * (1 - widthPct / 200),
    pool.currentPrice * (1 + widthPct / 200),
    orientation,
  );
  const current = economicPrice(pool.currentPrice, orientation);
  const sides = entrySides({
    capitalUsd,
    entryPrice: current,
    lowerPrice: bounds.lowerPrice,
    upperPrice: bounds.upperPrice,
    quotePriceUsd: orientation.quotePriceUsd,
  });
  if (sides.totalUsd <= 0) throw new LiveError("Could not size a valid LP range for this pool.");
  const baseDecimals = orientation.baseIsX ? pool.tokenX.decimals : pool.tokenY.decimals;
  const quoteDecimals = orientation.baseIsX ? pool.tokenY.decimals : pool.tokenX.decimals;
  return {
    baseAmount: sides.x,
    quoteAmount: sides.y,
    targetBaseRaw: toRawAmount(sides.x, baseDecimals),
    targetQuoteRaw: toRawAmount(sides.y, quoteDecimals),
  };
}

export async function openLiveDlmmPosition(input: {
  userId: string;
  bot: BotRecord;
  analysis: PoolAnalysis;
  actor?: "manual" | "bot";
  strategyOverride?: StrategyName;
}): Promise<PositionRecord> {
  const { userId, bot, analysis } = input;
  if (bot.mode !== "live") throw new LiveError("This bot is not in live mode.");
  if (analysis.pool.protocol !== "dlmm") {
    throw new LiveError("Live execution currently supports Meteora DLMM. DAMM v2 remains available for paper trading.");
  }
  return withLock(`portfolio:${userId}`, async () => {
    const context = liveContext(userId, { requireArming: true });
    const settings = getUserSettings(userId);
    const failures = eligibilityFailures(analysis, {
      risk: settings.risk,
      botConfig: bot.config,
    });
    if (failures.length) throw new LiveError(`${failures[0]}. Live entry blocked.`);
    const livePositions = getPositions(userId, { mode: "live", status: "open" });
    if (livePositions.some((position) => position.poolAddress === analysis.pool.address)) {
      throw new LiveError("A live position is already open in this pool.");
    }
    if (livePositions.length >= settings.risk.maxOpenPositions) {
      throw new LiveError("Live position limit reached.");
    }
    const botPositions = livePositions.filter((position) => position.botId === bot.id);
    if (botPositions.length >= bot.config.maxOpenPositions) {
      throw new LiveError("This bot has reached its live position limit.");
    }
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const notionalToday = liveNotionalSince(userId, dayStart.getTime());
    const remainingNotional = settings.risk.liveDailyNotionalLimitUsd - notionalToday;
    if (remainingNotional < MIN_LIVE_POSITION_USD) {
      throw new LiveError("The live daily notional limit has been reached.");
    }
    const capital = Math.min(
      bot.config.capitalPerPositionUsd,
      settings.risk.liveMaxPerTradeUsd,
      remainingNotional,
    );
    if (capital < MIN_LIVE_POSITION_USD) throw new LiveError("Live position size is below the minimum.");

    const orientation = getPoolOrientation(analysis.pool);
    if (!orientation) throw new LiveError("This pool has no recognised USD quote asset.");
    const connection = getConnection();
    const owner = context.signer.publicKey;

    const nativeLamports = await connection.getBalance(owner, "confirmed");
    const nativeSol = nativeLamports / 1_000_000_000;
    const quoteIsSol = orientation.quote.address === SOL_MINT;
    if (nativeSol < (quoteIsSol ? MIN_LIVE_SOL_RESERVE + 0.05 : MIN_LIVE_SOL_RESERVE)) {
      throw new LiveError(
        `Execution wallet needs at least ${MIN_LIVE_SOL_RESERVE.toFixed(2)} SOL for rent and fees.`,
      );
    }

    const widthPct = bot.config.rangeMode === "manual" ? bot.config.rangeWidthPct : analysis.range.widthPct;
    const amounts = orientationAmounts(analysis.pool, capital, widthPct);
    const baseMint = new PublicKey(orientation.base.address);
    const quoteMint = new PublicKey(orientation.quote.address);
    const maxSlippage = Math.min(settings.risk.maxSlippageBps, bot.config.slippageBps);

    let baseRaw = await getRawTokenBalance(owner, baseMint);
    let quoteRaw = await getRawTokenBalance(owner, quoteMint);
    if (quoteRaw < amounts.targetQuoteRaw) {
      throw new LiveError(
        `Not enough ${orientation.quote.symbol} in the execution wallet for a $${capital.toFixed(0)} position.`,
      );
    }

    if (baseRaw < amounts.targetBaseRaw) {
      const deficitBase = fromRawAmount(amounts.targetBaseRaw - baseRaw, orientation.base.decimals);
      const quoteNeeded = (deficitBase * orientation.basePriceUsd * 1.01) / Math.max(0.000001, orientation.quotePriceUsd);
      const quoteRawNeeded = toRawAmount(quoteNeeded, orientation.quote.decimals);
      if (quoteRaw - amounts.targetQuoteRaw < quoteRawNeeded) {
        throw new LiveError(
          `Not enough ${orientation.quote.symbol} to fund both sides of this LP position.`,
        );
      }
      if (quoteIsSol) await ensureWrappedSol(connection, context.signer, Number(quoteRawNeeded));
      const swap = await jupiterSwap({
        signer: context.signer,
        inputMint: orientation.quote.address,
        outputMint: orientation.base.address,
        amountRaw: quoteRawNeeded,
        slippageBps: maxSlippage,
        maxPriceImpactPct: bot.config.maxPriceImpactPct,
      });
      logActivity({
        userId,
        botId: bot.id,
        level: "info",
        category: "live",
        message: `Funded ${deficitBase.toFixed(4)} ${orientation.base.symbol} from ${orientation.quote.symbol} before LP entry`,
        metadata: { swap: swap.signature, priceImpactPct: swap.priceImpactPct },
      });
      baseRaw = await getRawTokenBalance(owner, baseMint);
      quoteRaw = await getRawTokenBalance(owner, quoteMint);
      if (baseRaw < (amounts.targetBaseRaw * 97n) / 100n) {
        throw new LiveError("Base token funding fell short after the swap. Aborting live entry.");
      }
      amounts.targetBaseRaw = baseRaw > amounts.targetBaseRaw ? amounts.targetBaseRaw : (baseRaw * 98n) / 100n;
    }
    if (quoteRaw < amounts.targetQuoteRaw) {
      throw new LiveError(`Not enough ${orientation.quote.symbol} after funding both sides.`);
    }

    const sdk = await import("@meteora-ag/dlmm");
    const pool = await sdk.default.create(connection, new PublicKey(analysis.pool.address), {
      cluster: getConfig().cluster,
    });
    const active = await pool.getActiveBin();
    const rawWidth = widthPct / 100;
    const lowerTarget = analysis.pool.currentPrice * (1 - rawWidth / 2);
    const upperTarget = analysis.pool.currentPrice * (1 + rawWidth / 2);
    let lowerBin = pool.getBinIdFromPrice(lowerTarget, true);
    let upperBin = pool.getBinIdFromPrice(upperTarget, false);
    lowerBin = Math.max(active.binId - MAX_BINS_PER_TX, Math.min(lowerBin, active.binId - 1));
    upperBin = Math.min(active.binId + MAX_BINS_PER_TX, Math.max(upperBin, active.binId + 1));
    if (upperBin - lowerBin < 2) {
      lowerBin = active.binId - 1;
      upperBin = active.binId + 1;
    }
    const strategyName = resolveStrategyName(bot, analysis, input.strategyOverride);
    const positionKeypair = Keypair.generate();

    const totalXRaw = orientation.baseIsX ? amounts.targetBaseRaw : amounts.targetQuoteRaw;
    const totalYRaw = orientation.baseIsX ? amounts.targetQuoteRaw : amounts.targetBaseRaw;
    if (totalXRaw <= 0n && totalYRaw <= 0n) throw new LiveError("Deposit amounts are zero.");
    const transaction = await pool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionKeypair.publicKey,
      user: owner,
      totalXAmount: new BN(totalXRaw.toString()),
      totalYAmount: new BN(totalYRaw.toString()),
      strategy: {
        minBinId: lowerBin,
        maxBinId: upperBin,
        strategyType: strategyEnum(strategyName, sdk),
      },
      slippage: maxSlippage,
    });

    const transactionSignature = await signAndConfirm(transaction, [context.signer, positionKeypair]);
    const depositXUsd = fromRawAmount(totalXRaw, analysis.pool.tokenX.decimals) * analysis.pool.tokenX.priceUsd;
    const depositYUsd = fromRawAmount(totalYRaw, analysis.pool.tokenY.decimals) * analysis.pool.tokenY.priceUsd;
    const actualCapital = Math.min(capital, Math.max(MIN_LIVE_POSITION_USD, depositXUsd + depositYUsd));
    const lowerPrice = sdk.getPriceOfBinByBinId(lowerBin, analysis.pool.binStep).toNumber();
    const upperPrice = sdk.getPriceOfBinByBinId(upperBin, analysis.pool.binStep).toNumber();
    const now = nowMs();
    const entryX = fromRawAmount(totalXRaw, analysis.pool.tokenX.decimals);
    const entryY = fromRawAmount(totalYRaw, analysis.pool.tokenY.decimals);
    const feeDailyPct = estimatePaperFeeDailyPct(
      analysis.pool,
      Math.min(100, ((upperPrice - lowerPrice) / analysis.pool.currentPrice) * 100),
      Math.max(analysis.volatilityPct, 0.5),
    );

    const save = getDb().transaction(() => {
      const created = insertPosition({
        userId,
        botId: bot.id,
        mode: "live",
        protocol: "dlmm",
        poolAddress: analysis.pool.address,
        poolName: analysis.pool.name,
        strategy: strategyName,
        status: "open",
        capitalUsd: actualCapital,
        entryPrice: analysis.pool.currentPrice,
        currentPrice: analysis.pool.currentPrice,
        lowerBin,
        upperBin,
        lowerPrice,
        upperPrice,
        tokenXMint: analysis.pool.tokenX.address,
        tokenYMint: analysis.pool.tokenY.address,
        tokenXSymbol: analysis.pool.tokenX.symbol,
        tokenYSymbol: analysis.pool.tokenY.symbol,
        tokenXDecimals: analysis.pool.tokenX.decimals,
        tokenYDecimals: analysis.pool.tokenY.decimals,
        entryXAmount: entryX,
        entryYAmount: entryY,
        currentXAmount: entryX,
        currentYAmount: entryY,
        tokenXPriceUsd: analysis.pool.tokenX.priceUsd,
        tokenYPriceUsd: analysis.pool.tokenY.priceUsd,
        currentValueUsd: actualCapital,
        feeDailyPct,
        unclaimedFeesUsd: 0,
        claimedFeesUsd: 0,
        ilUsd: 0,
        pnlUsd: 0,
        pnlPct: 0,
        inRange: active.binId >= lowerBin && active.binId <= upperBin,
        outOfRangeSince: null,
        lastClaimedAt: null,
        positionAddress: positionKeypair.publicKey.toBase58(),
        nftMint: null,
        openedAt: now,
        lastAccruedAt: now,
        updatedAt: now,
        closedAt: null,
        closeReason: null,
        closeProceedsUsd: null,
        txOpen: transactionSignature.signature,
        txClose: null,
      });
      recordTransaction({
        userId,
        botId: bot.id,
        positionId: created.id,
        mode: "live",
        type: "open",
        status: "confirmed",
        signature: transactionSignature.signature,
        amountUsd: actualCapital,
        networkFeeUsd: (transactionSignature.feeLamports / 1_000_000_000) * 150,
        poolName: analysis.pool.name,
        metadata: {
          protocol: "dlmm",
          poolAddress: analysis.pool.address,
          strategy: strategyName,
          lowerBin,
          upperBin,
          lowerPrice,
          upperPrice,
          actor: input.actor ?? "manual",
        },
      });
      logActivity({
        userId,
        botId: bot.id,
        level: "success",
        category: "entry",
        message: `Live ${strategyName} LP opened in ${analysis.pool.name} · $${actualCapital.toFixed(0)} · bins ${lowerBin}–${upperBin}`,
        metadata: { positionId: created.id, signature: transactionSignature.signature },
      });
      return created;
    });
    const position = save();
    void notifyUser(
      userId,
      "open",
      `Tide LIVE entry\n${analysis.pool.name} · ${strategyName}\nCapital: $${actualCapital.toFixed(0)}\nTx: ${transactionSignature.signature}`,
    );
    return position;
  });
}

async function signAndConfirm(
  transaction: Parameters<typeof import("./solana").signAndSend>[1],
  signers: Keypair[],
) {
  const { signAndSend } = await import("./solana");
  return signAndSend(getConnection(), transaction, signers, "Meteora position");
}

interface LiveMark {
  position: PositionRecord;
  currentValueUsd: number;
  unclaimedFeesUsd: number;
  claimedFeesUsd: number;
  pnlUsd: number;
  pnlPct: number;
  inRange: boolean;
  ilUsd: number;
  xAmount: number;
  yAmount: number;
  xPriceUsd: number;
  yPriceUsd: number;
  currentPrice: number;
}

async function markDlmmPosition(
  pool: Awaited<ReturnType<Awaited<ReturnType<typeof import("@meteora-ag/dlmm").default.create>>["getPosition"]>>,
  position: PositionRecord,
  activeBin: number,
  prices: Record<string, { usdPrice?: number } | undefined>,
  poolSnapshot: PoolSnapshot,
): Promise<LiveMark> {
  const data = pool.positionData;
  const xPrice =
    prices[position.tokenXMint]?.usdPrice ??
    (poolSnapshot.tokenX.priceUsd || position.tokenXPriceUsd || 0);
  const yPrice =
    prices[position.tokenYMint]?.usdPrice ??
    (poolSnapshot.tokenY.priceUsd || position.tokenYPriceUsd || 0);
  const xAmount = fromRawAmount(data.totalXAmount, position.tokenXDecimals);
  const yAmount = fromRawAmount(data.totalYAmount, position.tokenYDecimals);
  const feeX = fromRawAmount(data.feeX.toString(), position.tokenXDecimals);
  const feeY = fromRawAmount(data.feeY.toString(), position.tokenYDecimals);
  const claimedX = fromRawAmount(data.totalClaimedFeeXAmount.toString(), position.tokenXDecimals);
  const claimedY = fromRawAmount(data.totalClaimedFeeYAmount.toString(), position.tokenYDecimals);
  const currentValueUsd = xAmount * xPrice + yAmount * yPrice;
  const unclaimedFeesUsd = feeX * xPrice + feeY * yPrice;
  const claimedFeesUsd = claimedX * xPrice + claimedY * yPrice;
  const holdValueUsd =
    position.entryXAmount * xPrice + position.entryYAmount * yPrice;
  const ilUsd = currentValueUsd - holdValueUsd;
  const pnlUsd = currentValueUsd + unclaimedFeesUsd + claimedFeesUsd - position.capitalUsd;
  const inRange = activeBin >= data.lowerBinId && activeBin <= data.upperBinId;
  const lowerPrice = position.lowerPrice;
  const upperPrice = position.upperPrice;
  const rawPrice = xAmount > 0 && yAmount > 0 ? yAmount / xAmount : position.currentPrice;
  return {
    position,
    currentValueUsd,
    unclaimedFeesUsd,
    claimedFeesUsd,
    pnlUsd,
    pnlPct: (pnlUsd / Math.max(1, position.capitalUsd)) * 100,
    inRange,
    ilUsd,
    xAmount,
    yAmount,
    xPriceUsd: xPrice,
    yPriceUsd: yPrice,
    currentPrice: rawPrice > 0 ? rawPrice : position.currentPrice,
  };
}

const globalForLiveSync = globalThis as unknown as { tideLiveSync?: Map<string, number> };
const liveSyncAt = (globalForLiveSync.tideLiveSync ??= new Map());

export async function syncLivePositionsIfStale(userId: string, minIntervalMs = 60_000): Promise<number> {
  const last = liveSyncAt.get(userId) ?? 0;
  if (nowMs() - last < minIntervalMs) return 0;
  liveSyncAt.set(userId, nowMs());
  return syncLivePositions(userId);
}

export async function syncLivePositions(userId: string): Promise<number> {
  const positions = getPositions(userId, { mode: "live", status: "open" });
  if (!positions.length) return 0;
  const connection = getConnection();
  const sdk = await import("@meteora-ag/dlmm");
  const pools = new Map<string, typeof positions>();
  for (const position of positions) {
    const list = pools.get(position.poolAddress) ?? [];
    list.push(position);
    pools.set(position.poolAddress, list);
  }
  let synced = 0;
  for (const [poolAddress, group] of pools) {
    const protocol = group[0].protocol;
    if (protocol !== "dlmm") continue;
    try {
      const snapshot = await getPoolDetail("dlmm", poolAddress);
      const pool = await sdk.default.create(connection, new PublicKey(poolAddress), {
        cluster: getConfig().cluster,
      });
      const active = await pool.getActiveBin();
      const prices = await getJupiterPrices([snapshot.tokenX.address, snapshot.tokenY.address]);
      for (const position of group) {
        if (!position.positionAddress) continue;
        try {
          const onchain = await pool.getPosition(new PublicKey(position.positionAddress));
          const mark = await markDlmmPosition(onchain, position, active.binId, prices, snapshot);
          const now = nowMs();
          const outOfRangeSince = mark.inRange ? null : (position.outOfRangeSince ?? now);
          updatePosition(position.id, {
            current_price: mark.currentPrice,
            lower_bin: onchain.positionData.lowerBinId,
            upper_bin: onchain.positionData.upperBinId,
            current_x_amount: mark.xAmount,
            current_y_amount: mark.yAmount,
            token_x_price_usd: mark.xPriceUsd,
            token_y_price_usd: mark.yPriceUsd,
            current_value_usd: mark.currentValueUsd,
            unclaimed_fees_usd: mark.unclaimedFeesUsd,
            claimed_fees_usd: mark.claimedFeesUsd,
            il_usd: mark.ilUsd,
            pnl_usd: mark.pnlUsd,
            pnl_pct: mark.pnlPct,
            in_range: mark.inRange ? 1 : 0,
            out_of_range_since: outOfRangeSince,
            updated_at: now,
            last_accrued_at: now,
          });
          synced += 1;
        } catch (error) {
          if (isAccountMissing(error)) {
            closeExternally(position);
          } else {
            logActivity({
              userId,
              botId: position.botId,
              level: "error",
              category: "live",
              message: `Live sync failed for ${position.poolName}: ${error instanceof Error ? error.message : "unknown error"}`,
              metadata: { positionId: position.id },
            });
          }
        }
      }
    } catch (error) {
      logActivity({
        userId,
        level: "error",
        category: "live",
        message: `Could not reconcile ${group[0].poolName}: ${error instanceof Error ? error.message : "RPC error"}`,
      });
    }
  }
  return synced;
}

function isAccountMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not find account|account does not exist|AccountNotFound/i.test(message);
}

function closeExternally(position: PositionRecord): void {
  const now = nowMs();
  updatePosition(position.id, {
    status: "closed",
    current_value_usd: 0,
    unclaimed_fees_usd: 0,
    close_reason: "Closed outside Tide",
    close_proceeds_usd: 0,
    closed_at: now,
    updated_at: now,
  });
  recordTransaction({
    userId: position.userId,
    botId: position.botId,
    positionId: position.id,
    mode: "live",
    type: "close",
    status: "confirmed",
    amountUsd: 0,
    poolName: position.poolName,
    metadata: { reason: "external_close", positionAddress: position.positionAddress },
  });
  logActivity({
    userId: position.userId,
    botId: position.botId,
    level: "warning",
    category: "exit",
    message: `${position.poolName} was closed outside Tide. Position marked closed.`,
    metadata: { positionId: position.id },
  });
  void notifyUser(
    position.userId,
    "risk",
    `Tide detected an external close\n${position.poolName}\nThe position NFT is no longer under the execution wallet.`,
  );
}

export async function closeLivePosition(input: {
  userId: string;
  positionId: string;
  reason: string;
  actor?: "manual" | "bot" | "risk";
  requireArming?: boolean;
}): Promise<PositionRecord> {
  return withLock(`portfolio:${input.userId}`, async () => {
    const context = liveContext(input.userId, { requireArming: input.requireArming ?? false });
    let position = getPosition(input.userId, input.positionId);
    if (!position || position.status !== "open" || position.mode !== "live") {
      throw new LiveError("Open live position not found.");
    }
    if (position.protocol !== "dlmm") {
      throw new LiveError("Live close currently supports Meteora DLMM positions.");
    }
    if (!position.positionAddress) throw new LiveError("Position address is missing.");
    const positionAddress = position.positionAddress;
    const connection = getConnection();
    const sdk = await import("@meteora-ag/dlmm");
    const pool = await sdk.default.create(connection, new PublicKey(position.poolAddress), {
      cluster: getConfig().cluster,
    });
    let onchain;
    try {
      onchain = await pool.getPosition(new PublicKey(positionAddress));
    } catch (error) {
      if (isAccountMissing(error)) {
        closeExternally(position);
        return getPosition(input.userId, position.id)!;
      }
      throw error;
    }
    const snapshot = await getPoolDetail("dlmm", position.poolAddress);
    const prices = await getJupiterPrices([position.tokenXMint, position.tokenYMint]);
    const mark = await markDlmmPosition(
      onchain,
      position,
      onchain.positionData.lowerBinId,
      prices,
      snapshot,
    );
    updatePosition(position.id, {
      current_price: mark.currentPrice,
      current_value_usd: mark.currentValueUsd,
      unclaimed_fees_usd: mark.unclaimedFeesUsd,
      claimed_fees_usd: mark.claimedFeesUsd,
      il_usd: mark.ilUsd,
      pnl_usd: mark.pnlUsd,
      pnl_pct: mark.pnlPct,
      updated_at: nowMs(),
    });
    position = { ...position, ...mark };

    const transactions = await pool.removeLiquidity({
      user: context.signer.publicKey,
      position: new PublicKey(positionAddress),
      fromBinId: onchain.positionData.lowerBinId,
      toBinId: onchain.positionData.upperBinId,
      bps: new BN(10_000),
      shouldClaimAndClose: true,
    });
    let lastSignature = "";
    let feeLamports = 0;
    for (const transaction of transactions) {
      const sent = await signAndConfirm(transaction, [context.signer]);
      lastSignature = sent.signature;
      feeLamports += sent.feeLamports;
    }
    const proceeds = mark.currentValueUsd + mark.unclaimedFeesUsd;
    const totalClaimed = position.claimedFeesUsd + mark.unclaimedFeesUsd;
    const pnl = proceeds + position.claimedFeesUsd - position.capitalUsd;
    const now = nowMs();
    const save = getDb().transaction(() => {
      updatePosition(position!.id, {
        status: "closed",
        current_value_usd: 0,
        unclaimed_fees_usd: 0,
        claimed_fees_usd: totalClaimed,
        pnl_usd: pnl,
        pnl_pct: (pnl / Math.max(1, position!.capitalUsd)) * 100,
        close_reason: input.reason,
        close_proceeds_usd: proceeds,
        closed_at: now,
        updated_at: now,
        tx_close: lastSignature,
      });
      recordTransaction({
        userId: input.userId,
        botId: position!.botId,
        positionId: position!.id,
        mode: "live",
        type: "close",
        status: "confirmed",
        signature: lastSignature,
        amountUsd: proceeds,
        networkFeeUsd: (feeLamports / 1_000_000_000) * 150,
        poolName: position!.poolName,
        metadata: { reason: input.reason, pnl, actor: input.actor ?? "manual" },
      });
      logActivity({
        userId: input.userId,
        botId: position!.botId,
        level: pnl >= 0 ? "success" : "warning",
        category: "exit",
        message: `Live exit ${position!.poolName} · ${input.reason} · PnL $${pnl.toFixed(2)}`,
        metadata: { positionId: position!.id, signature: lastSignature },
      });
    });
    save();
    void notifyUser(
      input.userId,
      "close",
      `Tide LIVE exit\n${position.poolName} · ${input.reason}\nPnL: $${pnl.toFixed(2)} (${((pnl / Math.max(1, position.capitalUsd)) * 100).toFixed(2)}%)\nProceeds: $${proceeds.toFixed(2)}\nTx: ${lastSignature}`,
    );
    return getPosition(input.userId, position.id)!;
  });
}

export async function claimLiveFees(input: {
  userId: string;
  positionId: string;
  actor?: "manual" | "bot";
}): Promise<PositionRecord> {
  return withLock(`portfolio:${input.userId}`, async () => {
    const context = liveContext(input.userId, { requireArming: false });
    const position = getPosition(input.userId, input.positionId);
    if (!position || position.status !== "open" || position.mode !== "live") {
      throw new LiveError("Open live position not found.");
    }
    if (position.protocol !== "dlmm" || !position.positionAddress) {
      throw new LiveError("Live fee claims currently support Meteora DLMM positions.");
    }
    const connection = getConnection();
    const sdk = await import("@meteora-ag/dlmm");
    const pool = await sdk.default.create(connection, new PublicKey(position.poolAddress), {
      cluster: getConfig().cluster,
    });
    const onchain = await pool.getPosition(new PublicKey(position.positionAddress));
    const transactions = await pool.claimSwapFee({
      owner: context.signer.publicKey,
      position: onchain,
    });
    let lastSignature = "";
    for (const transaction of transactions) {
      const sent = await signAndConfirm(transaction, [context.signer]);
      lastSignature = sent.signature;
    }
    const current = getPosition(input.userId, position.id)!;
    const claimed = current.unclaimedFeesUsd;
    updatePosition(position.id, {
      claimed_fees_usd: current.claimedFeesUsd + claimed,
      unclaimed_fees_usd: 0,
      last_claimed_at: nowMs(),
      updated_at: nowMs(),
      pnl_usd: current.currentValueUsd + current.claimedFeesUsd + claimed - current.capitalUsd,
    });
    recordTransaction({
      userId: input.userId,
      botId: position.botId,
      positionId: position.id,
      mode: "live",
      type: "claim",
      status: "confirmed",
      signature: lastSignature,
      amountUsd: claimed,
      poolName: position.poolName,
      metadata: { actor: input.actor ?? "manual" },
    });
    logActivity({
      userId: input.userId,
      botId: position.botId,
      level: "info",
      category: "fees",
      message: `Claimed $${claimed.toFixed(2)} live fees from ${position.poolName}`,
      metadata: { positionId: position.id, signature: lastSignature },
    });
    return getPosition(input.userId, position.id)!;
  });
}

export async function closeAllLivePositions(input: {
  userId: string;
  reason: string;
  actor?: "manual" | "risk";
}): Promise<{ closed: number; errors: string[] }> {
  const positions = getPositions(input.userId, { mode: "live", status: "open" });
  let closed = 0;
  const errors: string[] = [];
  for (const position of positions) {
    try {
      await closeLivePosition({
        userId: input.userId,
        positionId: position.id,
        reason: input.reason,
        actor: input.actor ?? "manual",
        requireArming: false,
      });
      closed += 1;
    } catch (error) {
      errors.push(`${position.poolName}: ${error instanceof Error ? error.message : "close failed"}`);
    }
  }
  return { closed, errors };
}

export async function getLiveDlmmPool(address: string) {
  const sdk = await import("@meteora-ag/dlmm");
  const connection = getConnection();
  return sdk.default.create(connection, new PublicKey(address), { cluster: getConfig().cluster });
}

export { economicRange };

export type Protocol = "dlmm" | "damm-v2";
export type TradingMode = "paper" | "live";
export type RiskProfile = "conservative" | "balanced" | "aggressive";
export type StrategyName = "Spot" | "Curve" | "BidAsk";
export type StrategyChoice = "auto" | "spot" | "curve" | "bidask";
export type BotStatus = "running" | "paused" | "error";
export type PositionStatus = "open" | "closed";

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  verified: boolean;
  freezeAuthorityDisabled: boolean;
  holders: number;
  marketCapUsd: number;
}

export interface PoolSnapshot {
  id: string;
  protocol: Protocol;
  address: string;
  name: string;
  tokenX: TokenInfo;
  tokenY: TokenInfo;
  currentPrice: number;
  tvlUsd: number;
  volume24hUsd: number;
  volume4hUsd: number;
  volume1hUsd: number;
  fees24hUsd: number;
  fees4hUsd: number;
  fees1hUsd: number;
  /** Annualised 24h fee/TVL ratio, in percent. */
  feeAprPct: number;
  /** Fee / TVL over the last 24h, in percent. */
  feeTvl24hPct: number;
  farmAprPct: number;
  baseFeePct: number;
  dynamicFeePct: number;
  binStep: number;
  createdAt: number;
  tags: string[];
  hasFarm: boolean;
}

export interface PoolSignals {
  ageHours: number;
  volumeToTvl: number;
  feeTrend: number;
  consistency: number;
  verifiedTokens: number;
  minHolders: number;
  quoteQuality: number;
}

export interface RiskFlag {
  code: string;
  label: string;
  severity: "info" | "warning" | "critical";
}

export interface RecommendedRange {
  lowerBin: number;
  upperBin: number;
  lowerPrice: number;
  upperPrice: number;
  widthBins: number;
  widthPct: number;
}

export interface PoolAnalysis {
  pool: PoolSnapshot;
  score: number;
  riskScore: number;
  confidence: number;
  feeAprPct: number;
  netAprPct: number;
  volatilityPct: number;
  recommendedStrategy: StrategyName;
  range: RecommendedRange;
  reasons: string[];
  warnings: string[];
  riskFlags: RiskFlag[];
  signals: PoolSignals;
  safety: TokenSafety;
  updatedAt: number;
}

export interface TokenSafety {
  status: "safe" | "watch" | "blocked" | "unknown";
  score: number;
  reasons: string[];
  checked: boolean;
}

export interface OhlcvCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RiskSettings {
  maxCapitalPerPoolPct: number;
  maxTotalExposurePct: number;
  maxOpenPositions: number;
  maxDrawdownPct: number;
  dailyLossLimitPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  minPoolTvlUsd: number;
  minPoolAgeHours: number;
  minTokenHolders: number;
  minScore: number;
  maxRiskScore: number;
  maxSlippageBps: number;
  rejectUnverifiedTokens: boolean;
  rebalanceCooldownMinutes: number;
  liveMaxPerTradeUsd: number;
  liveDailyNotionalLimitUsd: number;
}

export interface BotConfig {
  protocols: Protocol[];
  strategy: StrategyChoice;
  riskProfile: RiskProfile;
  capitalPerPositionUsd: number;
  maxOpenPositions: number;
  minFeeAprPct: number;
  minTvlUsd: number;
  minScore: number;
  rangeMode: "auto" | "manual";
  rangeWidthPct: number;
  rebalanceOutOfRangeMinutes: number;
  claimIntervalMinutes: number;
  compound: boolean;
  autoImprove: boolean;
  rotationEnabled: boolean;
  rotationMinDelta: number;
  stopLossPct: number;
  takeProfitPct: number;
  slippageBps: number;
  serviceFeeBps: number;
  intervalSeconds: number;
  cooldownMinutes: number;
  maxPriceImpactPct: number;
}

export interface RiskProfileDefaults {
  risk: RiskSettings;
  bot: Pick<
    BotConfig,
    | "capitalPerPositionUsd"
    | "maxOpenPositions"
    | "minFeeAprPct"
    | "minTvlUsd"
    | "minScore"
    | "rangeMode"
    | "rangeWidthPct"
    | "stopLossPct"
    | "takeProfitPct"
    | "slippageBps"
    | "rotationMinDelta"
  >;
}

export interface NotificationSettings {
  telegramEnabled: boolean;
  onOpen: boolean;
  onClose: boolean;
  onRisk: boolean;
  onError: boolean;
  dailySummary: boolean;
  chatId: string;
  hasToken: boolean;
}

export interface UserSettings {
  risk: RiskSettings;
  notifications: NotificationSettings;
}

export interface UserRecord {
  id: string;
  authWallet: string;
  displayName: string | null;
  createdAt: number;
  lastSeenAt: number;
  liveArmed: boolean;
  liveArmedUntil: number | null;
  killSwitch: boolean;
}

export interface WalletTokenBalance {
  mint: string;
  symbol: string;
  decimals: number;
  amount: number;
  priceUsd: number;
  valueUsd: number;
  isQuote: boolean;
}

export interface WalletSnapshot {
  address: string;
  solBalance: number;
  solPriceUsd: number;
  tokens: WalletTokenBalance[];
  totalValueUsd: number;
  fetchedAt: number;
  error: string | null;
}

export interface LiveReadiness {
  globallyEnabled: boolean;
  rpcReady: boolean;
  rpcReason: string | null;
  armedUntil: number | null;
  armed: boolean;
  killSwitch: boolean;
  wallet: ExecutionWalletRecord | null;
  canTrade: boolean;
  reason: string | null;
}

export interface ExecutionWalletRecord {
  userId: string;
  pubkey: string;
  createdAt: number;
  updatedAt: number;
}

export interface PaperAccount {
  userId: string;
  initialCapital: number;
  cash: number;
  peakEquity: number;
  dayStartEquity: number;
  dayKey: string;
  updatedAt: number;
}

export interface BotRecord {
  id: string;
  userId: string;
  name: string;
  status: BotStatus;
  mode: TradingMode;
  config: BotConfig;
  lastRunAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PositionRecord {
  id: string;
  userId: string;
  botId: string | null;
  mode: TradingMode;
  protocol: Protocol;
  poolAddress: string;
  poolName: string;
  strategy: StrategyName;
  status: PositionStatus;
  capitalUsd: number;
  entryPrice: number;
  currentPrice: number;
  lowerBin: number;
  upperBin: number;
  lowerPrice: number;
  upperPrice: number;
  tokenXMint: string;
  tokenYMint: string;
  tokenXSymbol: string;
  tokenYSymbol: string;
  tokenXDecimals: number;
  tokenYDecimals: number;
  entryXAmount: number;
  entryYAmount: number;
  currentXAmount: number;
  currentYAmount: number;
  tokenXPriceUsd: number;
  tokenYPriceUsd: number;
  currentValueUsd: number;
  feeDailyPct: number;
  unclaimedFeesUsd: number;
  claimedFeesUsd: number;
  ilUsd: number;
  pnlUsd: number;
  pnlPct: number;
  inRange: boolean;
  outOfRangeSince: number | null;
  lastClaimedAt: number | null;
  positionAddress: string | null;
  nftMint: string | null;
  openedAt: number;
  lastAccruedAt: number;
  updatedAt: number;
  closedAt: number | null;
  closeReason: string | null;
  closeProceedsUsd: number | null;
  txOpen: string | null;
  txClose: string | null;
}

export interface PositionView extends PositionRecord {
  valueUsd: number;
  ageMinutes: number;
}

export interface PortfolioSummary {
  mode: TradingMode;
  initialCapital: number;
  cash: number;
  positionsValue: number;
  unclaimedFees: number;
  equity: number;
  totalPnl: number;
  totalPnlPct: number;
  realizedPnl: number;
  unrealizedPnl: number;
  feeIncome: number;
  claimedFees: number;
  impermanentLoss: number;
  estAprPct: number;
  maxDrawdownPct: number;
  openPositions: number;
  exposurePct: number;
  dayPnl: number;
  dayPnlPct: number;
  winRate: number;
}

export interface ActivityRecord {
  id: string;
  userId: string;
  botId: string | null;
  level: "info" | "success" | "warning" | "error";
  category: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface TransactionRecord {
  id: string;
  userId: string;
  botId: string | null;
  positionId: string | null;
  mode: TradingMode;
  type: string;
  status: "simulated" | "pending" | "confirmed" | "failed";
  signature: string | null;
  amountUsd: number;
  feeUsd: number;
  networkFeeUsd: number;
  poolName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface EquityPoint {
  ts: number;
  equity: number;
  cash: number;
  positionsValue: number;
  pnl: number;
  fees: number;
}

export interface BotStats {
  botId: string;
  openPositions: number;
  closedPositions: number;
  netPnl: number;
  fees: number;
  winRate: number;
  lastRunAt: number | null;
}

export type ImproveHeat = "hot" | "steady" | "cooling" | "cold";

export interface PoolFeedback {
  poolAddress: string;
  poolName: string;
  trades: number;
  wins: number;
  losses: number;
  stopLosses: number;
  netPnl: number;
  winRate: number;
  lastClosedAt: number;
  lastStopAt: number | null;
  blockedUntil: number | null;
  blockReason: string | null;
  scoreAdjustment: number;
}

export interface StrategyFeedback {
  strategy: StrategyName;
  trades: number;
  wins: number;
  netPnl: number;
  winRate: number;
  adjustment: number;
  status: "boost" | "neutral" | "penalized";
}

export interface ImprovementState {
  mode: TradingMode;
  enabled: boolean;
  heat: ImproveHeat;
  evaluatedAt: number;
  windowDays: number;
  sampleTrades: number;
  totalTrades: number;
  netPnl: number;
  winRate: number;
  stopLosses: number;
  consecutiveLosses: number;
  drawdownPct: number;
  totalPnlPct: number;
  entryScoreFloorDelta: number;
  capitalScale: number;
  rotationDeltaBonus: number;
  rebalanceMinutesBonus: number;
  pauseEntries: boolean;
  pauseReason: string | null;
  pauseUntil: number | null;
  blockedPools: PoolFeedback[];
  pools: PoolFeedback[];
  strategies: StrategyFeedback[];
  actions: string[];
}

export interface BacktestConfig {
  protocol: Protocol;
  poolAddress: string;
  poolName: string;
  strategy: StrategyChoice;
  days: number;
  timeframe: "30m" | "1h" | "4h";
  capitalUsd: number;
  rangeWidthPct: number;
  feeCaptureRatio: number;
  rebalanceOutOfRange: boolean;
  rebalanceCooldownHours: number;
  stopLossPct: number;
  takeProfitPct: number;
  costBpsPerRebalance: number;
}

export interface BacktestTrade {
  openedAt: number;
  closedAt: number | null;
  entryPrice: number;
  exitPrice: number | null;
  lowerPrice: number;
  upperPrice: number;
  feesUsd: number;
  pnlUsd: number;
  pnlPct: number;
  reason: string;
}

export interface BacktestResult {
  initialCapital: number;
  finalEquity: number;
  totalReturnPct: number;
  annualizedPct: number;
  maxDrawdownPct: number;
  timeInRangePct: number;
  feesUsd: number;
  costsUsd: number;
  rebalances: number;
  winRate: number;
  sharpe: number;
  candles: number;
  equityCurve: EquityPoint[];
  trades: BacktestTrade[];
  assumptions: string[];
}

export interface BacktestRecord {
  id: string;
  userId: string;
  poolName: string;
  protocol: Protocol;
  createdAt: number;
  config: BacktestConfig;
  result: BacktestResult;
}

export interface DashboardData {
  user: UserRecord;
  executionWallet: ExecutionWalletRecord | null;
  paper: PaperAccount;
  summary: PortfolioSummary;
  liveSummary: PortfolioSummary;
  livePositions: PositionView[];
  liveReadiness: LiveReadiness;
  wallet: WalletSnapshot | null;
  positions: PositionView[];
  bots: BotRecord[];
  botStats: BotStats[];
  activity: ActivityRecord[];
  transactions: TransactionRecord[];
  equityCurve: EquityPoint[];
  improvement: ImprovementState;
  liveImprovement: ImprovementState;
  settings: UserSettings;
  market: {
    stats: ProtocolStats;
    topPools: PoolAnalysis[];
    lastUpdated: number;
    stale: boolean;
  };
}

export interface ProtocolStats {
  totalTvlUsd: number;
  volume24hUsd: number;
  fee24hUsd: number;
  totalPools: number;
  refreshedAt: number;
}

export interface ScannerResponse {
  pools: PoolAnalysis[];
  stats: ProtocolStats;
  cachedAt: number;
  stale: boolean;
  universe: {
    total: number;
    dlmm: number;
    damm: number;
    matched: number;
    deep: number;
  };
}

export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: unknown;
}

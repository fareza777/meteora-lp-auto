import bs58 from "bs58";

export type WalletKind = "phantom" | "solflare" | "backpack" | "injected";

interface PublicKeyLike {
  toBase58(): string;
}

interface SolanaProvider {
  publicKey?: PublicKeyLike | null;
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  isConnected?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean } | unknown): Promise<{ publicKey?: PublicKeyLike } | void>;
  disconnect?(): Promise<void>;
  signMessage(
    message: Uint8Array,
    display?: "utf8",
  ): Promise<Uint8Array | { signature: Uint8Array }>;
}

declare global {
  interface Window {
    phantom?: { solana?: SolanaProvider };
    solflare?: SolanaProvider;
    backpack?: SolanaProvider;
    solana?: SolanaProvider;
  }
}

export interface DetectedWallet {
  kind: WalletKind;
  name: string;
  provider: SolanaProvider;
  installed: boolean;
}

interface WalletCandidate {
  kind: WalletKind;
  name: string;
  provider: SolanaProvider | undefined;
  installUrl: string;
}

export function walletCandidates(): WalletCandidate[] {
  if (typeof window === "undefined") return [];
  const phantom = window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : undefined);
  const solflare = window.solflare;
  const backpack =
    window.backpack ?? (window.solana?.isBackpack ? window.solana : undefined);
  const generic =
    window.solana && window.solana !== phantom && window.solana !== backpack
      ? window.solana
      : undefined;
  return [
    { kind: "phantom", name: "Phantom", provider: phantom, installUrl: "https://phantom.app/download" },
    { kind: "solflare", name: "Solflare", provider: solflare, installUrl: "https://solflare.com/download" },
    { kind: "backpack", name: "Backpack", provider: backpack, installUrl: "https://backpack.app/download" },
    { kind: "injected", name: "Browser wallet", provider: generic, installUrl: "https://solana.com/ecosystem" },
  ];
}

export function detectedWallets(): DetectedWallet[] {
  return walletCandidates()
    .filter((entry): entry is WalletCandidate & { provider: SolanaProvider } => Boolean(entry.provider))
    .map((entry) => ({ ...entry, installed: true }));
}

export async function connectProvider(provider: SolanaProvider): Promise<string> {
  const result = await provider.connect();
  const publicKey =
    (result && "publicKey" in result ? result.publicKey : null) ?? provider.publicKey ?? null;
  if (!publicKey) throw new Error("The wallet did not return an address.");
  return publicKey.toBase58();
}

export async function signWalletMessage(
  provider: SolanaProvider,
  message: string,
): Promise<string> {
  const encoded = new TextEncoder().encode(message);
  let signature: Uint8Array | null = null;
  try {
    const result = await provider.signMessage(encoded, "utf8");
    signature =
      result instanceof Uint8Array
        ? result
        : result && "signature" in result
          ? result.signature
          : null;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/reject|denied|cancel/i.test(text)) throw new Error("Signature request was rejected.");
    throw new Error(text || "The wallet could not sign the message.");
  }
  if (!signature || signature.length === 0) throw new Error("The wallet returned an empty signature.");
  return bs58.encode(signature);
}

export function walletByKind(kind: WalletKind): SolanaProvider | null {
  const entry = walletCandidates().find((candidate) => candidate.kind === kind);
  return entry?.provider ?? null;
}

export function explorerTx(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

export function explorerAddress(address: string): string {
  return `https://solscan.io/account/${address}`;
}

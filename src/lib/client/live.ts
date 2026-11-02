import { apiPost } from "./api";
import {
  connectProvider,
  detectedWallets,
  signWalletMessage,
  type DetectedWallet,
} from "./wallet";

export async function signLiveAction(
  purpose: "enable-live" | "emergency-exit",
  expectedWallet: string,
): Promise<{ nonce: string; signature: string }> {
  const wallets = detectedWallets();
  if (!wallets.length) {
    throw new Error(
      "No Solana wallet detected in this browser. Open Tide in the wallet you signed in with.",
    );
  }

  const alreadyConnected = wallets.find(
    (wallet) => wallet.provider.publicKey?.toBase58() === expectedWallet,
  );
  let match: DetectedWallet | null = alreadyConnected ?? null;

  if (!match) {
    for (const wallet of wallets) {
      try {
        const address = await connectProvider(wallet.provider);
        if (address === expectedWallet) {
          match = wallet;
          break;
        }
      } catch {
        // try the next injected wallet
      }
    }
  }

  if (!match) {
    throw new Error(
      `Connect the wallet you signed in with (${expectedWallet.slice(0, 4)}…${expectedWallet.slice(-4)}) to approve this action.`,
    );
  }

  const issued = await apiPost<{ nonce: string; message: string }>("/api/live/arm/nonce", {
    purpose,
  });
  const signature = await signWalletMessage(match.provider, issued.message);
  return { nonce: issued.nonce, signature };
}

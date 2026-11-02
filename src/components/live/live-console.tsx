"use client";

import { useState } from "react";
import {
  ArrowDownToLine,
  CircleCheck,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  Power,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import type { LiveReadiness, WalletSnapshot } from "@/lib/types";
import { fmtCompact, fmtCountdown, fmtDate, fmtUsd, shortAddress, timeAgo } from "@/lib/client/format";
import { apiDelete, apiPost, errorMessage } from "@/lib/client/api";
import { signLiveAction } from "@/lib/client/live";
import { explorerAddress } from "@/lib/client/wallet";
import { Badge, Button, CopyButton, Modal, Panel } from "../ui";
import { useToast } from "../toast";
import { EmergencyExitModal } from "./emergency-exit";

function CheckRow({
  done,
  title,
  sub,
}: {
  done: boolean;
  title: string;
  sub: string;
}) {
  return (
    <div className={`check-item ${done ? "done" : ""}`}>
      <span className="ci-ic">
        {done ? <CircleCheck /> : <LockKeyhole />}
      </span>
      <div className="ci-text">
        <div className="ci-title">{title}</div>
        <div className="ci-sub">{sub}</div>
      </div>
    </div>
  );
}

export function LiveConsole({
  readiness,
  authWallet,
  walletSnapshot,
  paperOpen,
  liveOpen,
  onChanged,
}: {
  readiness: LiveReadiness;
  authWallet: string;
  walletSnapshot?: WalletSnapshot | null;
  paperOpen: number;
  liveOpen: number;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createWallet() {
    setBusy("wallet");
    setError(null);
    try {
      await apiPost("/api/live/wallet");
      toast.success("Execution wallet created", "Fund it with SOL and quote tokens before opening live positions.");
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
      toast.fromError("Could not create the wallet", caught);
    } finally {
      setBusy(null);
    }
  }

  async function removeWallet() {
    setBusy("remove");
    try {
      await apiDelete("/api/live/wallet");
      setRemoveOpen(false);
      toast.success("Execution wallet removed");
      onChanged();
    } catch (caught) {
      toast.fromError("Could not remove the wallet", caught);
    } finally {
      setBusy(null);
    }
  }

  async function withdrawFunds() {
    setBusy("withdraw");
    try {
      const result = await apiPost<{
        signatures: string[];
        tokenAccounts: number;
        solLamports: number;
        failed: string[];
      }>("/api/live/withdraw");
      setWithdrawOpen(false);
      toast.success(
        "Funds sent to your signed-in wallet",
        `${(result.solLamports / 1_000_000_000).toFixed(4)} SOL and ${result.tokenAccounts} token balance${result.tokenAccounts === 1 ? "" : "s"}.`,
      );
      if (result.failed.length) {
        toast.error(
          `${result.failed.length} asset${result.failed.length === 1 ? "" : "s"} could not be swept`,
          result.failed[0],
        );
      }
      onChanged();
    } catch (caught) {
      toast.fromError("Withdrawal failed", caught);
    } finally {
      setBusy(null);
    }
  }

  async function arm() {
    setBusy("arm");
    setError(null);
    try {
      const { nonce, signature } = await signLiveAction("enable-live", authWallet);
      await apiPost("/api/live/arm", { nonce, signature });
      toast.success("Live trading armed for 24 hours", "Readiness must stay green to execute.");
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
      toast.fromError("Arming failed", caught);
    } finally {
      setBusy(null);
    }
  }

  async function disarm() {
    setBusy("disarm");
    try {
      await apiPost("/api/live/disarm");
      toast.success("Live trading disarmed");
      onChanged();
    } catch (caught) {
      toast.fromError("Could not disarm", caught);
    } finally {
      setBusy(null);
    }
  }

  async function engageKill() {
    setBusy("kill");
    try {
      await apiPost("/api/live/kill");
      toast.success("Kill switch engaged", "All bots paused and live trading disarmed.");
      onChanged();
    } catch (caught) {
      toast.fromError("Could not engage the kill switch", caught);
    } finally {
      setBusy(null);
    }
  }

  async function resume() {
    setBusy("resume");
    try {
      await apiPost("/api/live/resume");
      setResumeOpen(false);
      toast.success("Kill switch disengaged", "Live trading still needs a fresh 24-hour arming signature.");
      onChanged();
    } catch (caught) {
      toast.fromError("Could not resume", caught);
    } finally {
      setBusy(null);
    }
  }

  const checks = [
    {
      done: readiness.globallyEnabled,
      title: "Server live flag",
      sub: readiness.globallyEnabled
        ? "LIVE_TRADING_ENABLED is on."
        : "Set LIVE_TRADING_ENABLED=true on the server and restart.",
    },
    {
      done: readiness.rpcReady,
      title: "Dedicated Solana RPC",
      sub: readiness.rpcReady ? "RPC accepted for automatic signing." : readiness.rpcReason ?? "A dedicated RPC is required.",
    },
    {
      done: Boolean(readiness.wallet),
      title: "Encrypted execution wallet",
      sub: readiness.wallet
        ? `${shortAddress(readiness.wallet.pubkey, 5)} · created ${timeAgo(readiness.wallet.createdAt)}`
        : "Create a server-side hot wallet to sign Meteora transactions.",
    },
    {
      done: readiness.armed,
      title: "24-hour session arming",
      sub: readiness.armed
        ? `Armed · expires in ${fmtCountdown(readiness.armedUntil)}`
        : "Sign a time-boxed message with your auth wallet.",
    },
    {
      done: !readiness.killSwitch,
      title: "Kill switch clear",
      sub: readiness.killSwitch ? "Halted. Resume controls, then re-arm." : "No global halt is active.",
    },
  ];

  const armDisabled =
    !readiness.globallyEnabled || !readiness.rpcReady || !readiness.wallet || readiness.killSwitch;
  const withdrawable = Boolean(
    walletSnapshot &&
      (walletSnapshot.solBalance > 0.006 || walletSnapshot.tokens.some((token) => token.amount > 0)),
  );

  return (
    <div className="col gap14">
      <Panel
        title="Live execution gates"
        icon={<ShieldCheck />}
        subtitle="Real signing stays locked until every gate is green."
        action={
          <Badge tone={readiness.canTrade ? "green" : readiness.killSwitch ? "red" : "amber"} dot>
            {readiness.canTrade ? "Ready" : readiness.killSwitch ? "Halted" : "Locked"}
          </Badge>
        }
      >
        <div className="checklist">
          {checks.map((check) => (
            <CheckRow key={check.title} {...check} />
          ))}
        </div>

        {readiness.reason ? (
          <div className={`notice ${readiness.killSwitch ? "danger" : "warn"} mt12`}>
            <TriangleAlert />
            <span>{readiness.reason}</span>
          </div>
        ) : (
          <div className="notice accent mt12">
            <ShieldCheck />
            <span>
              All gates are green. Live bots and manual live entries can execute until
              {" "}
              {readiness.armedUntil ? fmtDate(readiness.armedUntil) : "the arming expires"}.
            </span>
          </div>
        )}

        {error ? (
          <div className="notice danger mt12">
            <TriangleAlert />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="row wrap gap8 mt16">
          {!readiness.wallet ? (
            <Button variant="primary" onClick={createWallet} loading={busy === "wallet"}>
              <KeyRound />
              Create execution wallet
            </Button>
          ) : null}
          {readiness.wallet && !readiness.armed ? (
            <Button
              variant="amber"
              onClick={arm}
              loading={busy === "arm"}
              disabled={armDisabled}
              title={armDisabled ? readiness.reason ?? "Complete the gates first" : "Sign the arming message"}
            >
              <ShieldCheck />
              Sign 24-hour arm
            </Button>
          ) : null}
          {readiness.armed ? (
            <Button variant="secondary" onClick={disarm} loading={busy === "disarm"}>
              Disarm live
            </Button>
          ) : null}
          {readiness.killSwitch ? (
            <Button variant="outline" onClick={() => setResumeOpen(true)}>
              <Power />
              Resume controls
            </Button>
          ) : (
            <Button variant="danger" onClick={engageKill} loading={busy === "kill"}>
              <ShieldAlert />
              Engage kill switch
            </Button>
          )}
          <Button variant="ghost" onClick={() => setExitOpen(true)}>
            Emergency exit
          </Button>
        </div>
        <div className="hint mt8">
          Arming signs a message only — it does not move funds. Every live transaction is separately
          signed by the encrypted execution wallet and checked against your risk limits.
        </div>
      </Panel>

      <Panel
        title="Execution wallet"
        icon={<Wallet />}
        subtitle="A dedicated server-side hot wallet. The private key is not exportable."
        action={
          readiness.wallet ? (
            <Badge tone="accent" dot>
              Encrypted
            </Badge>
          ) : (
            <Badge tone="neutral">Not created</Badge>
          )
        }
      >
        {!readiness.wallet ? (
          <>
            <div className="notice warn">
              <TriangleAlert />
              <span>
                Live trading needs a funded execution wallet. Creating one generates a new Solana
                keypair inside the server, encrypted with AES-256-GCM. You will fund it manually with
                SOL for fees and quote tokens for liquidity.
              </span>
            </div>
            <Button variant="primary" className="mt16" onClick={createWallet} loading={busy === "wallet"}>
              <KeyRound />
              Generate encrypted wallet
            </Button>
          </>
        ) : (
          <>
            <div className="row between wrap">
              <div className="col gap6">
                <span className="eyebrow">Public address</span>
                <div className="row gap6">
                  <CopyButton value={readiness.wallet.pubkey} label={shortAddress(readiness.wallet.pubkey, 8)} />
                  <a
                    className="icon-btn"
                    href={explorerAddress(readiness.wallet.pubkey)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View on Solscan"
                  >
                    <ExternalLink />
                  </a>
                </div>
              </div>
              <div className="t-right">
                <span className="eyebrow">On-chain balance</span>
                <div className="mono" style={{ fontSize: 18, marginTop: 7 }}>
                  {walletSnapshot ? fmtUsd(walletSnapshot.totalValueUsd) : "—"}
                </div>
                <div className="dimtx">
                  {walletSnapshot
                    ? `${walletSnapshot.solBalance.toFixed(3)} SOL · ${walletSnapshot.tokens.length} tokens`
                    : "Sync pending"}
                </div>
              </div>
            </div>

            {walletSnapshot?.error ? (
              <div className="notice warn mt12">
                <TriangleAlert />
                <span>{walletSnapshot.error}</span>
              </div>
            ) : null}

            {walletSnapshot && walletSnapshot.tokens.length ? (
              <div className="mt12">
                {walletSnapshot.tokens.slice(0, 4).map((token) => (
                  <div className="kv" key={token.mint}>
                    <span className="k">
                      {token.symbol} {token.isQuote ? <span className="badge tone-cyan">quote</span> : null}
                    </span>
                    <span className="v">
                      {token.amount.toLocaleString("en-US", { maximumFractionDigits: 3 })} · {fmtUsd(token.valueUsd)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="row between wrap mt16">
              <span className="dimtx">Created {fmtDate(readiness.wallet.createdAt)} · key sealed</span>
              <div className="row gap6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setWithdrawOpen(true)}
                  disabled={liveOpen > 0 || !withdrawable}
                  title={
                    liveOpen > 0
                      ? "Close all live positions first"
                      : withdrawable
                        ? "Sweep funds to your signed-in wallet"
                        : "No balance to withdraw"
                  }
                >
                  <ArrowDownToLine />
                  Withdraw
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setRemoveOpen(true)}
                  disabled={liveOpen > 0}
                  title={liveOpen > 0 ? "Close all live positions first" : "Remove the execution wallet"}
                >
                  <Trash2 />
                  Remove wallet
                </Button>
              </div>
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="Danger controls"
        icon={<ShieldAlert />}
        subtitle="The handbrake. Nothing restarts automatically."
      >
        <div className="grid g2">
          <div className="col gap8">
            <div className="h3">Kill switch</div>
            <p className="hint">
              Pauses every bot and disarms live trading instantly. Open positions stay open.
            </p>
            <div className="row gap6">
              {readiness.killSwitch ? (
                <Button variant="outline" size="sm" onClick={() => setResumeOpen(true)}>
                  <Power />
                  Resume controls
                </Button>
              ) : (
                <Button variant="danger" size="sm" onClick={engageKill} loading={busy === "kill"}>
                  Engage
                </Button>
              )}
            </div>
          </div>
          <div className="col gap8">
            <div className="h3">Emergency exit</div>
            <p className="hint">
              Closes the paper or live book at the current mark, pauses bots and engages the kill
              switch for live.
            </p>
            <div className="row gap6">
              <Button variant="danger" size="sm" onClick={() => setExitOpen(true)}>
                Exit book
              </Button>
            </div>
          </div>
        </div>
      </Panel>

      <Modal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title="Withdraw to your wallet"
        subtitle="Sweeps every token balance and the native SOL balance from the execution wallet."
        icon={<ArrowDownToLine />}
        size="sm"
        footer={
          <div className="row between w-full">
            <Button variant="ghost" onClick={() => setWithdrawOpen(false)} disabled={busy === "withdraw"}>
              Cancel
            </Button>
            <Button variant="primary" onClick={withdrawFunds} loading={busy === "withdraw"}>
              Withdraw funds
            </Button>
          </div>
        }
      >
        <p className="sub">
          Funds are sent only to <strong>{shortAddress(authWallet, 6)}</strong>, the wallet you signed
          in with. The encrypted key is never exported and the destination cannot be changed from the
          browser.
        </p>
        <div className="notice warn mt12">
          <TriangleAlert />
          <span>
            Close all live positions first. SOL is left behind for transaction fees, and a small
            amount of rent stays with the now-empty token accounts.
          </span>
        </div>
      </Modal>

      <Modal
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        title="Remove execution wallet"
        subtitle="This deletes the encrypted key from the server. It cannot be recovered."
        icon={<Trash2 />}
        size="sm"
        footer={
          <div className="row between w-full">
            <Button variant="ghost" onClick={() => setRemoveOpen(false)} disabled={busy === "remove"}>
              Cancel
            </Button>
            <Button variant="danger" onClick={removeWallet} loading={busy === "remove"}>
              Remove permanently
            </Button>
          </div>
        }
      >
        <div className="notice danger">
          <TriangleAlert />
          <span>
            Withdraw the balance first. Removing the wallet deletes the only key that can move the
            remaining funds. Removing it locks live trading until a new wallet is created and armed.
          </span>
        </div>
      </Modal>

      <Modal
        open={resumeOpen}
        onClose={() => setResumeOpen(false)}
        title="Resume live controls"
        subtitle="This clears the halt but does not arm live trading."
        icon={<Power />}
        size="sm"
        footer={
          <div className="row between w-full">
            <Button variant="ghost" onClick={() => setResumeOpen(false)} disabled={busy === "resume"}>
              Cancel
            </Button>
            <Button variant="primary" onClick={resume} loading={busy === "resume"}>
              Resume controls
            </Button>
          </div>
        }
      >
        <p className="sub">
          Bots remain paused. After resuming, you must start each bot again and sign a fresh 24-hour
          arming message before live orders can execute.
        </p>
      </Modal>

      <EmergencyExitModal
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        authWallet={authWallet}
        liveReadiness={readiness}
        paperOpen={paperOpen}
        liveOpen={liveOpen}
        onDone={onChanged}
      />
    </div>
  );
}

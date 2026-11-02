"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bell,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Send,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  UserRound,
  Wallet,
} from "lucide-react";
import type {
  ExecutionWalletRecord,
  NotificationSettings,
  RiskSettings,
  UserRecord,
  WalletSnapshot,
} from "@/lib/types";
import { fmtDate, shortAddress } from "@/lib/client/format";
import { useDashboard, useRefreshAll } from "@/lib/client/hooks";
import { apiPost, apiPut, errorMessage } from "@/lib/client/api";
import { explorerAddress } from "@/lib/client/wallet";
import { PageError, PageLoading } from "@/components/page-states";
import {
  Badge,
  Button,
  CopyButton,
  Field,
  Modal,
  Panel,
  Toggle,
} from "@/components/ui";
import { LiveConsole } from "@/components/live/live-console";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/components/toast";

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="input-wrap">
        <input
          className={suffix ? "input with-suffix" : "input"}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {suffix ? <span className="input-suffix">{suffix}</span> : null}
      </div>
    </Field>
  );
}

function RiskLimitsPanel({ initial }: { initial: RiskSettings }) {
  const toast = useToast();
  const refreshAll = useRefreshAll();
  const [risk, setRisk] = useState<RiskSettings>(initial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof RiskSettings>(key: K, value: RiskSettings[K]) {
    setRisk((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await apiPut<{ settings: { risk: RiskSettings } }>("/api/settings/risk", risk);
      setRisk(response.settings.risk);
      setDirty(false);
      toast.success("Risk limits saved", "Every new entry and rebalance uses the new guardrails.");
      await refreshAll();
    } catch (caught) {
      setError(errorMessage(caught));
      toast.fromError("Could not save risk limits", caught);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Risk limits"
      icon={<ShieldCheck />}
      subtitle="Server-enforced on every entry, rebalance and live order."
      action={<Badge tone={dirty ? "amber" : "green"} dot>{dirty ? "Unsaved" : "Active"}</Badge>}
    >
      <div className="form-section">
        <div className="form-section-head">
          <span className="form-section-title">Capital &amp; exposure</span>
        </div>
        <div className="form-grid">
          <NumberField
            label="Max per pool"
            value={risk.maxCapitalPerPoolPct}
            onChange={(value) => set("maxCapitalPerPoolPct", value)}
            min={1}
            max={100}
            suffix="%"
          />
          <NumberField
            label="Max total exposure"
            value={risk.maxTotalExposurePct}
            onChange={(value) => set("maxTotalExposurePct", value)}
            min={1}
            max={100}
            suffix="%"
          />
          <NumberField
            label="Max open positions"
            value={risk.maxOpenPositions}
            onChange={(value) => set("maxOpenPositions", value)}
            min={1}
            max={20}
          />
          <NumberField
            label="Max drawdown"
            value={risk.maxDrawdownPct}
            onChange={(value) => set("maxDrawdownPct", value)}
            min={0.5}
            max={80}
            step={0.5}
            suffix="%"
          />
          <NumberField
            label="Daily loss limit"
            value={risk.dailyLossLimitPct}
            onChange={(value) => set("dailyLossLimitPct", value)}
            min={0.5}
            max={50}
            step={0.5}
            suffix="%"
          />
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-head">
          <span className="form-section-title">Stops &amp; execution</span>
        </div>
        <div className="form-grid">
          <NumberField
            label="Stop loss"
            value={risk.stopLossPct}
            onChange={(value) => set("stopLossPct", value)}
            min={0.5}
            max={80}
            step={0.5}
            suffix="%"
          />
          <NumberField
            label="Take profit"
            value={risk.takeProfitPct}
            onChange={(value) => set("takeProfitPct", value)}
            min={1}
            max={500}
            suffix="%"
          />
          <NumberField
            label="Max slippage"
            value={risk.maxSlippageBps}
            onChange={(value) => set("maxSlippageBps", value)}
            min={10}
            max={1_000}
            step={5}
            suffix="bps"
          />
          <NumberField
            label="Rebalance cooldown"
            value={risk.rebalanceCooldownMinutes}
            onChange={(value) => set("rebalanceCooldownMinutes", value)}
            min={5}
            max={1_440}
            suffix="min"
          />
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-head">
          <span className="form-section-title">Pool quality screen</span>
        </div>
        <div className="form-grid">
          <NumberField
            label="Minimum TVL"
            value={risk.minPoolTvlUsd}
            onChange={(value) => set("minPoolTvlUsd", value)}
            min={10_000}
            max={100_000_000}
            step={10_000}
            suffix="USD"
          />
          <NumberField
            label="Minimum pool age"
            value={risk.minPoolAgeHours}
            onChange={(value) => set("minPoolAgeHours", value)}
            min={0}
            max={720}
            suffix="hrs"
          />
          <NumberField
            label="Minimum holders"
            value={risk.minTokenHolders}
            onChange={(value) => set("minTokenHolders", value)}
            min={0}
            max={1_000_000}
            step={50}
          />
          <NumberField
            label="Minimum AI score"
            value={risk.minScore}
            onChange={(value) => set("minScore", value)}
            min={0}
            max={100}
          />
          <NumberField
            label="Maximum risk score"
            value={risk.maxRiskScore}
            onChange={(value) => set("maxRiskScore", value)}
            min={1}
            max={100}
          />
        </div>
        <div className="mt12">
          <Toggle
            checked={risk.rejectUnverifiedTokens}
            onChange={(value) => set("rejectUnverifiedTokens", value)}
            label="Reject unverified tokens"
            sub="Blocks pools where either mint is unverified by the Meteora indexer."
          />
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-head">
          <span className="form-section-title">Live execution caps</span>
        </div>
        <div className="form-grid">
          <NumberField
            label="Max per live trade"
            value={risk.liveMaxPerTradeUsd}
            onChange={(value) => set("liveMaxPerTradeUsd", value)}
            min={10}
            max={1_000_000}
            step={50}
            suffix="USD"
          />
          <NumberField
            label="Daily live notional"
            value={risk.liveDailyNotionalLimitUsd}
            onChange={(value) => set("liveDailyNotionalLimitUsd", value)}
            min={10}
            max={5_000_000}
            step={100}
            suffix="USD"
          />
        </div>
        <p className="hint mt8">
          These caps only apply to live orders. Paper trading uses the same sizing rules without
          moving funds.
        </p>
      </div>

      {error ? (
        <div className="notice danger" style={{ marginBottom: 12 }}>
          <TriangleAlert />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="form-actions">
        <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
          Save risk limits
        </Button>
      </div>
    </Panel>
  );
}

function NotificationsPanel({
  initial,
  tokenSaved,
}: {
  initial: NotificationSettings;
  tokenSaved: boolean;
}) {
  const toast = useToast();
  const refreshAll = useRefreshAll();
  const [settings, setSettings] = useState<NotificationSettings>(initial);
  const [hasToken, setHasToken] = useState(tokenSaved);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removeTokenOpen, setRemoveTokenOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (token.trim()) {
        await apiPost("/api/settings/telegram", { token: token.trim(), chatId: settings.chatId });
        setHasToken(true);
        setToken("");
      }
      await apiPut("/api/settings/notifications", {
        telegramEnabled: settings.telegramEnabled,
        onOpen: settings.onOpen,
        onClose: settings.onClose,
        onRisk: settings.onRisk,
        onError: settings.onError,
        dailySummary: settings.dailySummary,
        chatId: settings.chatId,
      });
      toast.success("Notifications saved");
      await refreshAll();
    } catch (caught) {
      setError(errorMessage(caught));
      toast.fromError("Could not save notifications", caught);
    } finally {
      setSaving(false);
    }
  }

  async function removeToken() {
    setSaving(true);
    try {
      await apiPost("/api/settings/telegram", { token: null });
      setHasToken(false);
      setToken("");
      setRemoveTokenOpen(false);
      toast.success("Telegram token removed");
      await refreshAll();
    } catch (caught) {
      toast.fromError("Could not remove the token", caught);
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setError(null);
    try {
      await apiPost("/api/settings/telegram/test");
      toast.success("Test sent", "Check the Telegram chat for the test message.");
    } catch (caught) {
      setError(errorMessage(caught));
      toast.fromError("Test failed", caught);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Panel
      title="Notifications"
      icon={<Bell />}
      subtitle="Telegram alerts for entries, exits, risk events and errors."
      action={
        <Badge tone={settings.telegramEnabled && hasToken ? "green" : "neutral"} dot>
          {settings.telegramEnabled && hasToken ? "Connected" : "Off"}
        </Badge>
      }
    >
      <div className="col gap12">
        <Toggle
          checked={settings.telegramEnabled}
          onChange={(value) => set("telegramEnabled", value)}
          label="Enable Telegram alerts"
          sub="Delivery uses the server token and your chat ID. Secrets are redacted."
        />

        <Field
          label="Bot token"
          hint={
            hasToken
              ? "A token is stored encrypted. Enter a new one to replace it."
              : "Create a bot with @BotFather, then paste its token."
          }
          optional={<span>{hasToken ? "saved" : "optional"}</span>}
        >
          <input
            className="input"
            type="password"
            placeholder={hasToken ? "••••••••••••••••" : "123456789:AA…"}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <Field label="Chat ID" hint="Send /start to your bot, then paste the numeric chat ID.">
          <input
            className="input"
            placeholder="e.g. 123456789"
            value={settings.chatId}
            onChange={(event) => set("chatId", event.target.value.trim())}
            autoComplete="off"
          />
        </Field>

        <div className="grid g2" style={{ gap: 8 }}>
          <Toggle
            checked={settings.onOpen}
            onChange={(value) => set("onOpen", value)}
            label="Entries"
            disabled={!settings.telegramEnabled}
          />
          <Toggle
            checked={settings.onClose}
            onChange={(value) => set("onClose", value)}
            label="Exits"
            disabled={!settings.telegramEnabled}
          />
          <Toggle
            checked={settings.onRisk}
            onChange={(value) => set("onRisk", value)}
            label="Risk events"
            disabled={!settings.telegramEnabled}
          />
          <Toggle
            checked={settings.onError}
            onChange={(value) => set("onError", value)}
            label="Errors"
            disabled={!settings.telegramEnabled}
          />
          <Toggle
            checked={settings.dailySummary}
            onChange={(value) => set("dailySummary", value)}
            label="Daily summary"
            disabled={!settings.telegramEnabled}
          />
        </div>

        {error ? (
          <div className="notice danger">
            <TriangleAlert />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="row wrap gap6">
          <Button variant="primary" size="sm" onClick={save} loading={saving}>
            Save notifications
          </Button>
          <Button variant="outline" size="sm" onClick={sendTest} loading={testing}>
            <Send />
            Send test
          </Button>
          {hasToken ? (
            <Button variant="ghost" size="sm" onClick={() => setRemoveTokenOpen(true)}>
              <Trash2 />
              Remove token
            </Button>
          ) : null}
        </div>
        <p className="hint">
          The server never returns the saved token. Test alerts use the stored token and the chat ID
          above — save before testing.
        </p>
      </div>

      <Modal
        open={removeTokenOpen}
        onClose={() => setRemoveTokenOpen(false)}
        title="Remove Telegram token"
        subtitle="Alerts stop immediately. Existing activity history is untouched."
        icon={<Trash2 />}
        size="sm"
        footer={
          <div className="row between w-full">
            <Button variant="ghost" onClick={() => setRemoveTokenOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={removeToken} loading={saving}>
              Remove token
            </Button>
          </div>
        }
      >
        <p className="sub">
          You can add a new token at any time. The token is stored encrypted at rest and never shown
          again.
        </p>
      </Modal>
    </Panel>
  );
}

function AccountPanel({
  user,
  executionWallet,
  wallet,
}: {
  user: UserRecord;
  executionWallet: ExecutionWalletRecord | null;
  wallet: WalletSnapshot | null;
}) {
  return (
    <Panel
      title="Account & security"
      icon={<UserRound />}
      subtitle="Message-signing authentication, sealed execution keys and local appearance."
      className="mt16"
    >
      <div className="grid g3">
        <div className="col gap8">
          <span className="eyebrow">Authentication wallet</span>
          <span className="dimtx">Signs messages only. No funds held.</span>
          <div className="row gap6">
            <CopyButton value={user.authWallet} label={shortAddress(user.authWallet, 6)} />
            <a
              className="icon-btn"
              href={explorerAddress(user.authWallet)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View auth wallet on Solscan"
              title="View auth wallet on Solscan"
            >
              <ExternalLink />
            </a>
          </div>
          <span className="hint">Member since {fmtDate(user.createdAt, false)}</span>
        </div>

        <div className="col gap8">
          <span className="eyebrow">Execution wallet</span>
          {executionWallet ? (
            <>
              <div className="row gap6">
                <CopyButton value={executionWallet.pubkey} label={shortAddress(executionWallet.pubkey, 6)} />
                <a
                  className="icon-btn"
                  href={explorerAddress(executionWallet.pubkey)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="View execution wallet on Solscan"
                  title="View execution wallet on Solscan"
                >
                  <ExternalLink />
                </a>
              </div>
              <span className="hint">
                AES-256-GCM sealed · {wallet ? `${wallet.solBalance.toFixed(3)} SOL on-chain` : "sync pending"}
              </span>
            </>
          ) : (
            <>
              <span className="dimtx">Not created yet.</span>
              <span className="hint">
                Generate a dedicated hot wallet in the live console before arming.
              </span>
              <Link href="#live-console" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>
                <KeyRound />
                Live console
              </Link>
            </>
          )}
        </div>

        <div className="col gap8">
          <span className="eyebrow">Session &amp; appearance</span>
          <div className="row between">
            <span className="dimtx">Theme</span>
            <ThemeToggle />
          </div>
          <span className="hint">
            HttpOnly session cookie · CSRF header check · auth signatures expire in 5 minutes.
          </span>
        </div>
      </div>

      <div className="notice accent mt16">
        <ShieldCheck />
        <span>
          Tide never exposes a private key to the browser. The auth wallet signs login and arming
          messages; live transactions are signed server-side by the encrypted execution wallet after
          risk checks.
        </span>
      </div>
    </Panel>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const refreshAll = useRefreshAll();
  const { data, error, isLoading, mutate } = useDashboard();
  const [refreshing, setRefreshing] = useState(false);

  async function refreshNow() {
    setRefreshing(true);
    try {
      await mutate();
      toast.success("Settings refreshed");
    } catch {
      toast.error("Could not refresh settings");
    } finally {
      setRefreshing(false);
    }
  }

  if (isLoading && !data) return <PageLoading label="Loading settings" />;
  if (!data) {
    return (
      <PageError
        title="Settings could not load"
        message={error instanceof Error ? error.message : undefined}
        onRetry={() => mutate()}
      />
    );
  }

  const readiness = data.liveReadiness;
  const readinessBadge = readiness.killSwitch
    ? { tone: "red" as const, label: "Halted" }
    : readiness.canTrade
      ? { tone: "green" as const, label: "Live ready" }
      : { tone: "amber" as const, label: "Paper only" };

  return (
    <div className="page">
      <div className="page-head">
        <div className="lede">
          <div className="row gap8 wrap">
            <span className="eyebrow">System</span>
            <Badge tone={readinessBadge.tone} dot>
              {readinessBadge.label}
            </Badge>
            <span className="dimtx">Paper default · live gated by signed arming</span>
          </div>
          <h1 className="h1 mt8">Settings</h1>
          <p className="sub mt8">
            Set the guardrails once and every manual entry, bot cycle and live order runs through
            them. Live execution stays locked until the server, RPC, wallet and signed arming all
            agree.
          </p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={refreshNow} loading={refreshing}>
            <RefreshCw />
            Refresh
          </Button>
          <Link href="/dashboard" className="btn btn-outline">
            <Wallet />
            Desk
          </Link>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-stack" id="live-console">
          <LiveConsole
            readiness={readiness}
            authWallet={data.user.authWallet}
            walletSnapshot={data.wallet}
            paperOpen={data.summary.openPositions}
            liveOpen={data.liveSummary.openPositions}
            onChanged={() => {
              void refreshAll();
            }}
          />
        </div>

        <div className="dash-side">
          <RiskLimitsPanel key="risk-limits" initial={data.settings.risk} />
          <NotificationsPanel
            key="notifications"
            initial={data.settings.notifications}
            tokenSaved={data.settings.notifications.hasToken}
          />
          <Panel title="Live posture" icon={<ShieldAlert />} subtitle="Current gate state at a glance.">
            <div className="col gap6">
              <div className="kv">
                <span className="k">Server flag</span>
                <span className={`v ${readiness.globallyEnabled ? "up" : "dim"}`}>
                  {readiness.globallyEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="kv">
                <span className="k">Dedicated RPC</span>
                <span className={`v ${readiness.rpcReady ? "up" : "dim"}`}>
                  {readiness.rpcReady ? "Ready" : "Not ready"}
                </span>
              </div>
              <div className="kv">
                <span className="k">Execution wallet</span>
                <span className={`v ${readiness.wallet ? "up" : "dim"}`}>
                  {readiness.wallet ? "Sealed" : "Missing"}
                </span>
              </div>
              <div className="kv">
                <span className="k">24h arming</span>
                <span className={`v ${readiness.armed ? "up" : "dim"}`}>
                  {readiness.armed ? fmtDate(readiness.armedUntil) : "Not armed"}
                </span>
              </div>
              <div className="kv">
                <span className="k">Kill switch</span>
                <span className={`v ${readiness.killSwitch ? "down" : "up"}`}>
                  {readiness.killSwitch ? "Engaged" : "Clear"}
                </span>
              </div>
            </div>
            {readiness.reason ? (
              <div className={`notice ${readiness.killSwitch ? "danger" : "warn"} mt12`}>
                <TriangleAlert />
                <span>{readiness.reason}</span>
              </div>
            ) : null}
          </Panel>
        </div>
      </div>

      <AccountPanel
        user={data.user}
        executionWallet={data.executionWallet}
        wallet={data.wallet}
      />
    </div>
  );
}

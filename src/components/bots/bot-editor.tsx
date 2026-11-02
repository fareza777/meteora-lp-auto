"use client";

import { useEffect, useState } from "react";
import { Bot, LockKeyhole, Sparkles, TriangleAlert } from "lucide-react";
import type {
  BotConfig,
  BotRecord,
  LiveReadiness,
  Protocol,
  RiskProfile,
  StrategyChoice,
  TradingMode,
} from "@/lib/types";
import { createDefaultBotConfig, getProfileDefaults, RISK_PROFILE_COPY } from "@/lib/defaults";
import { apiPatch, apiPost, errorMessage, validationMessages } from "@/lib/client/api";
import { fmtUsd } from "@/lib/client/format";
import { Badge, Button, Drawer, Field, Segmented, Toggle } from "../ui";
import { useToast } from "../toast";

const PROFILES: RiskProfile[] = ["conservative", "balanced", "aggressive"];

export function BotEditor({
  open,
  onClose,
  bot,
  readiness,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  bot: BotRecord | null;
  readiness: LiveReadiness;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<TradingMode>("paper");
  const [config, setConfig] = useState<BotConfig>(() => createDefaultBotConfig("balanced"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (bot) {
      setName(bot.name);
      setMode(bot.mode);
      setConfig(structuredClone(bot.config));
    } else {
      setName("");
      setMode("paper");
      setConfig(createDefaultBotConfig("balanced"));
    }
    setError(null);
  }, [open, bot]);

  function set<K extends keyof BotConfig>(key: K, value: BotConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function applyProfile(profile: RiskProfile) {
    const defaults = getProfileDefaults(profile).bot;
    setConfig((current) => ({ ...current, ...defaults, riskProfile: profile }));
  }

  function toggleProtocol(protocol: Protocol) {
    const active = config.protocols.includes(protocol);
    if (active && config.protocols.length === 1) return;
    setConfig((current) => ({
      ...current,
      protocols: active
        ? current.protocols.filter((item) => item !== protocol)
        : [...current.protocols, protocol],
    }));
  }

  const liveModeBlocked = mode === "live" && !readiness.canTrade && bot?.mode !== "live";

  function validate(): string | null {
    if (!name.trim()) return "Give the bot a name.";
    if (name.trim().length > 48) return "Bot names are limited to 48 characters.";
    if (!config.protocols.length) return "Select at least one protocol.";
    if (config.capitalPerPositionUsd < 10) return "Capital per position must be at least $10.";
    if (config.maxOpenPositions < 1 || config.maxOpenPositions > 20) return "Positions must be between 1 and 20.";
    if (config.rangeMode === "manual" && (config.rangeWidthPct < 0.4 || config.rangeWidthPct > 90)) {
      return "Range width must be between 0.4% and 90%.";
    }
    if (config.stopLossPct < 0.5 || config.stopLossPct > 80) return "Stop loss must be between 0.5% and 80%.";
    if (config.takeProfitPct < 1 || config.takeProfitPct > 500) return "Take profit must be between 1% and 500%.";
    if (config.slippageBps < 10 || config.slippageBps > 1000) return "Slippage must be 10–1000 bps.";
    if (config.intervalSeconds < 20 || config.intervalSeconds > 86_400) return "Interval must be 20–86,400 seconds.";
    return null;
  }

  async function save() {
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        config,
      };
      if (!bot || mode !== bot.mode) payload.mode = mode;
      if (bot) {
        await apiPatch(`/api/bots/${bot.id}`, payload);
        toast.success("Bot updated", name.trim());
      } else {
        await apiPost("/api/bots", { ...payload, name: name.trim(), mode });
        toast.success("Bot created", `${name.trim()} starts paused. Start it when ready.`);
      }
      onSaved();
      onClose();
    } catch (caught) {
      const details = validationMessages(caught);
      setError(details.length ? details.join(" · ") : errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  const profileCopy = RISK_PROFILE_COPY[config.riskProfile];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={bot ? `Edit ${bot.name}` : "New autopilot"}
      subtitle={bot ? "Changes apply on the next tick." : "Bots are created paused; review the mandate before starting."}
      icon={<Bot />}
      size="lg"
      footer={
        <div className="row between w-full">
          <span className="dimtx">{mode === "live" ? "Live execution" : "Simulated execution"}</span>
          <div className="row gap8">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} loading={saving} disabled={liveModeBlocked}>
              {bot ? "Save changes" : "Create bot"}
            </Button>
          </div>
        </div>
      }
    >
      {error ? (
        <div className="notice danger" style={{ marginBottom: 16 }}>
          <TriangleAlert />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="form-section">
        <div className="form-grid">
          <Field label="Bot name">
            <input
              className="input"
              value={name}
              maxLength={48}
              placeholder="e.g. Aurora"
              onChange={(event) => setName(event.target.value)}
              style={{ fontFamily: "var(--font-sans)" }}
            />
          </Field>
          <Field label="Execution mode" hint={mode === "live" ? "Real capital · signed server-side" : "Simulated book"}>
            <Segmented
              value={mode}
              onChange={(value) => setMode(value)}
              options={[
                { value: "paper" as TradingMode, label: "Paper" },
                { value: "live" as TradingMode, label: "Live" },
              ]}
              accent
              ariaLabel="Bot execution mode"
            />
          </Field>
        </div>
        {mode === "live" ? (
          <div className={`notice ${readiness.canTrade ? "accent" : "warn"} mt12`}>
            <LockKeyhole />
            <span>
              {readiness.canTrade
                ? "Live execution is armed. The bot uses the same risk limits and execution wallet as manual live trades."
                : readiness.reason ?? "Live trading is not ready. Complete the gates in Settings first."}
            </span>
          </div>
        ) : null}
      </div>

      <div className="form-section">
        <div className="form-section-head">
          <span className="form-section-title">Risk profile</span>
          <Badge tone="accent">{profileCopy.label}</Badge>
        </div>
        <div className="choice-grid">
          {PROFILES.map((profile) => (
            <button
              key={profile}
              type="button"
              className={`choice ${config.riskProfile === profile ? "active" : ""}`}
              onClick={() => applyProfile(profile)}
            >
              <span className="ct">{RISK_PROFILE_COPY[profile].label}</span>
              <span className="cs">{RISK_PROFILE_COPY[profile].tldr}</span>
            </button>
          ))}
        </div>
        <div className="hint mt8">
          Selecting a profile loads its defaults for sizing, filters, range and exits. Tune any field
          afterwards — this bot keeps its own mandate.
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-head">
          <span className="form-section-title">Sizing &amp; cadence</span>
        </div>
        <div className="form-grid">
          <Field label="Capital per position" hint="Upper bound; live trades are also capped by risk settings.">
            <div className="input-wrap">
              <input
                className="input with-suffix"
                type="number"
                min={10}
                step={100}
                value={config.capitalPerPositionUsd}
                onChange={(event) => set("capitalPerPositionUsd", Number(event.target.value))}
              />
              <span className="input-suffix">USD</span>
            </div>
          </Field>
          <Field label="Max open positions">
            <input
              className="input"
              type="number"
              min={1}
              max={20}
              value={config.maxOpenPositions}
              onChange={(event) => set("maxOpenPositions", Number(event.target.value))}
            />
          </Field>
          <Field label="Tick interval" hint={`Every ${Math.max(1, Math.round(config.intervalSeconds / 60))} minute(s)`}>
            <div className="input-wrap">
              <input
                className="input with-suffix"
                type="number"
                min={20}
                step={10}
                value={config.intervalSeconds}
                onChange={(event) => set("intervalSeconds", Number(event.target.value))}
              />
              <span className="input-suffix">sec</span>
            </div>
          </Field>
          <Field label="Entry cooldown" hint="After closing a pool, wait before re-entry.">
            <div className="input-wrap">
              <input
                className="input with-suffix"
                type="number"
                min={1}
                value={config.cooldownMinutes}
                onChange={(event) => set("cooldownMinutes", Number(event.target.value))}
              />
              <span className="input-suffix">min</span>
            </div>
          </Field>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-head">
          <span className="form-section-title">Pool filters</span>
        </div>
        <div className="row gap6 wrap" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`chip ${config.protocols.includes("dlmm") ? "active" : ""}`}
            onClick={() => toggleProtocol("dlmm")}
          >
            DLMM
          </button>
          <button
            type="button"
            className={`chip ${config.protocols.includes("damm-v2") ? "active" : ""}`}
            onClick={() => toggleProtocol("damm-v2")}
          >
            DAMM v2
          </button>
          <span className="dimtx" style={{ marginLeft: 4 }}>
            {mode === "live" ? "Live orders currently execute on DLMM only." : "Both protocols supported in paper mode."}
          </span>
        </div>
        <div className="form-grid">
          <Field label="Minimum fee APR" hint="Skip pools below this annualised fee yield.">
            <div className="input-wrap">
              <input
                className="input with-suffix"
                type="number"
                min={0}
                step={1}
                value={config.minFeeAprPct}
                onChange={(event) => set("minFeeAprPct", Number(event.target.value))}
              />
              <span className="input-suffix">%</span>
            </div>
          </Field>
          <Field label="Minimum TVL" hint="Depth filter before scoring.">
            <div className="input-wrap">
              <input
                className="input with-suffix"
                type="number"
                min={0}
                step={10_000}
                value={config.minTvlUsd}
                onChange={(event) => set("minTvlUsd", Number(event.target.value))}
              />
              <span className="input-suffix">USD</span>
            </div>
          </Field>
          <Field label="Minimum opportunity score">
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              value={config.minScore}
              onChange={(event) => set("minScore", Number(event.target.value))}
            />
          </Field>
          <Field label="Rotation edge" hint="Minimum net APR advantage to rotate an open position.">
            <div className="input-wrap">
              <input
                className="input with-suffix"
                type="number"
                min={1}
                value={config.rotationMinDelta}
                onChange={(event) => set("rotationMinDelta", Number(event.target.value))}
              />
              <span className="input-suffix">%</span>
            </div>
          </Field>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-head">
          <span className="form-section-title">Range &amp; fees</span>
        </div>
        <div className="form-grid">
          <Field label="Strategy">
            <select
              className="select"
              value={config.strategy}
              onChange={(event) => set("strategy", event.target.value as StrategyChoice)}
            >
              <option value="auto">Auto · engine recommendation</option>
              <option value="spot">Spot</option>
              <option value="curve">Curve</option>
              <option value="bidask">BidAsk</option>
            </select>
          </Field>
          <Field label="Range mode">
            <select
              className="select"
              value={config.rangeMode}
              onChange={(event) => set("rangeMode", event.target.value as "auto" | "manual")}
            >
              <option value="auto">Auto · engine optimised</option>
              <option value="manual">Manual width</option>
            </select>
          </Field>
          <Field label="Range width" hint="Half-width around entry price when manual.">
            <div className="input-wrap">
              <input
                className="input with-suffix"
                type="number"
                min={0.4}
                step={0.5}
                disabled={config.rangeMode === "auto"}
                value={config.rangeWidthPct}
                onChange={(event) => set("rangeWidthPct", Number(event.target.value))}
              />
              <span className="input-suffix">%</span>
            </div>
          </Field>
          <Field label="Out-of-range rebalance">
            <div className="input-wrap">
              <input
                className="input with-suffix"
                type="number"
                min={1}
                value={config.rebalanceOutOfRangeMinutes}
                onChange={(event) => set("rebalanceOutOfRangeMinutes", Number(event.target.value))}
              />
              <span className="input-suffix">min</span>
            </div>
          </Field>
          <Field label="Auto-claim interval" hint="Claim accrued fees and move them to cash.">
            <div className="input-wrap">
              <input
                className="input with-suffix"
                type="number"
                min={5}
                step={30}
                value={config.claimIntervalMinutes}
                onChange={(event) => set("claimIntervalMinutes", Number(event.target.value))}
              />
              <span className="input-suffix">min</span>
            </div>
          </Field>
          <Field label="Max price impact">
            <div className="input-wrap">
              <input
                className="input with-suffix"
                type="number"
                min={0.05}
                step={0.05}
                value={config.maxPriceImpactPct}
                onChange={(event) => set("maxPriceImpactPct", Number(event.target.value))}
              />
              <span className="input-suffix">%</span>
            </div>
          </Field>
        </div>
        <div className="mt8">
          <Toggle
            checked={config.compound}
            onChange={(value) => set("compound", value)}
            label="Compound fee income"
            sub="Scale position size with realised fees, capped by capital limits."
          />
          <Toggle
            checked={config.autoImprove}
            onChange={(value) => set("autoImprove", value)}
            label="Auto-improve from results"
            sub="Adapt sizing, entry filters, rotation edge and re-entry bans from this bot's closed trades."
          />
          <Toggle
            checked={config.rotationEnabled}
            onChange={(value) => set("rotationEnabled", value)}
            label="Rotate to better pools"
            sub="Close a healthy position when a materially better pool is available."
          />
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-head">
          <span className="form-section-title">Exits &amp; execution</span>
        </div>
        <div className="form-grid">
          <Field label="Stop loss">
            <div className="input-wrap">
              <input
                className="input with-suffix"
                type="number"
                min={0.5}
                max={80}
                step={0.5}
                value={config.stopLossPct}
                onChange={(event) => set("stopLossPct", Number(event.target.value))}
              />
              <span className="input-suffix">%</span>
            </div>
          </Field>
          <Field label="Take profit">
            <div className="input-wrap">
              <input
                className="input with-suffix"
                type="number"
                min={1}
                step={1}
                value={config.takeProfitPct}
                onChange={(event) => set("takeProfitPct", Number(event.target.value))}
              />
              <span className="input-suffix">%</span>
            </div>
          </Field>
          <Field label="Slippage tolerance">
            <div className="input-wrap">
              <input
                className="input with-suffix"
                type="number"
                min={10}
                max={1000}
                step={5}
                value={config.slippageBps}
                onChange={(event) => set("slippageBps", Number(event.target.value))}
              />
              <span className="input-suffix">bps</span>
            </div>
          </Field>
          <Field label="Service fee" optional={<span>advanced</span>}>
            <div className="input-wrap">
              <input
                className="input with-suffix"
                type="number"
                min={0}
                max={500}
                value={config.serviceFeeBps}
                onChange={(event) => set("serviceFeeBps", Number(event.target.value))}
              />
              <span className="input-suffix">bps</span>
            </div>
          </Field>
        </div>
      </div>

      <div className="notice" style={{ background: "var(--surface-3)" }}>
        <Sparkles />
        <span>
          Sizing example: up to{" "}
          <strong style={{ color: "var(--text)" }}>
            {fmtUsd(config.capitalPerPositionUsd * config.maxOpenPositions)}
          </strong>{" "}
          deployed across {config.maxOpenPositions} positions. Global exposure and drawdown limits still
          apply.
        </span>
      </div>
    </Drawer>
  );
}

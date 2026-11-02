"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bot,
  ChevronRight,
  ExternalLink,
  FlaskConical,
  Gauge,
  LockKeyhole,
  Radar,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wallet,
} from "lucide-react";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui";
import { apiPost, errorMessage } from "@/lib/client/api";
import {
  connectProvider,
  signWalletMessage,
  walletCandidates,
  type WalletKind,
} from "@/lib/client/wallet";

const FEATURES = [
  {
    icon: Radar,
    title: "Smart pool scanner",
    copy: "Ranks real Meteora DLMM and DAMM v2 pools by fee APR, 24h fees, depth, volatility, token safety and profit consistency — not marketing APR.",
  },
  {
    icon: Sparkles,
    title: "Strategy engine",
    copy: "Each pool gets a risk score, a Spot / Curve / BidAsk recommendation, an optimised bin range and a plain-language explanation.",
  },
  {
    icon: Bot,
    title: "Autonomous LP desk",
    copy: "Entries, claims, compounding, out-of-range rebalances and pool rotation — evaluated every tick against net expected return.",
  },
  {
    icon: ShieldCheck,
    title: "Risk before yield",
    copy: "Rug filters, per-pool caps, exposure ceilings, stop-loss, take-profit, drawdown halts, cooldowns and a global kill switch.",
  },
  {
    icon: Gauge,
    title: "Live operations room",
    copy: "Equity, fees, realised APR, impermanent loss, range health, wallet balances, transactions and every decision in one console.",
  },
  {
    icon: FlaskConical,
    title: "Backtest & paper first",
    copy: "Replay a pool's candles with fees, costs, rebalances and stop rules. Prove the strategy on a simulated book before arming capital.",
  },
];

const STEPS = [
  {
    title: "Sign in with your wallet",
    copy: "A gasless ownership signature creates your workspace. No transaction, no key leaves your wallet.",
  },
  {
    title: "Tune the mandate",
    copy: "Pick a risk profile, capital per pool, range width, drawdown limits and rotation thresholds.",
  },
  {
    title: "Run paper first",
    copy: "The bot trades a $25,000 simulated book with live pool prices, fees and rebalances. Audit every action.",
  },
  {
    title: "Arm live deliberately",
    copy: "Enable the server flag, fund the encrypted execution wallet, then sign a 24-hour arming window.",
  },
];

function Bins() {
  const bars = useMemo(
    () =>
      Array.from({ length: 30 }, (_, index) => {
        const wave = Math.sin(index * 0.52) * 0.5 + 0.5;
        const spike = index === 17 || index === 18 ? 1 : 0;
        return 16 + Math.round(wave * 54 + spike * 26);
      }),
    [],
  );
  return (
    <div className="hero-visual" aria-hidden>
      <svg viewBox="0 0 460 380" width="460" height="380">
        <defs>
          <linearGradient id="bin-grad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#5cf2c1" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#5cf2c1" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        {bars.map((height, index) => (
          <rect
            key={index}
            x={index * 15 + 4}
            y={330 - height * 3}
            width="7"
            height={height * 3}
            rx="3"
            fill={index === 17 || index === 18 ? "#5cf2c1" : "url(#bin-grad)"}
            opacity={index === 17 || index === 18 ? 0.9 : 0.5}
          />
        ))}
        <line x1="0" y1="330" x2="460" y2="330" stroke="rgba(174,196,190,.16)" />
        <circle cx="256" cy="180" r="120" fill="none" stroke="rgba(92,242,193,.12)" strokeDasharray="2 6" />
      </svg>
    </div>
  );
}

export function Landing({ devLoginEnabled }: { devLoginEnabled: boolean }) {
  const [wallets, setWallets] = useState<
    ReturnType<typeof walletCandidates>
  >([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWallets(walletCandidates());
    const onLoad = () => setWallets(walletCandidates());
    window.addEventListener("load", onLoad);
    const timer = setTimeout(onLoad, 900);
    return () => {
      window.removeEventListener("load", onLoad);
      clearTimeout(timer);
    };
  }, []);

  async function login(kind: WalletKind, installUrl: string) {
    setError(null);
    const entry = walletCandidates().find((candidate) => candidate.kind === kind);
    if (!entry?.provider) {
      window.open(installUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setBusy(kind);
    try {
      const wallet = await connectProvider(entry.provider);
      const issued = await apiPost<{ nonce: string; message: string }>("/api/auth/nonce", { wallet });
      const signature = await signWalletMessage(entry.provider, issued.message);
      await apiPost("/api/auth/login", { wallet, nonce: issued.nonce, signature });
      window.location.assign("/dashboard");
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(null);
    }
  }

  async function devLogin() {
    setError(null);
    setBusy("dev");
    try {
      await apiPost("/api/auth/dev");
      window.location.assign("/dashboard");
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(null);
    }
  }

  function walletRow(
    kind: WalletKind,
    name: string,
    letter: string,
    installUrl: string,
    installed: boolean,
    note: string,
  ) {
    return (
      <button
        key={kind}
        className="wallet-btn"
        onClick={() => login(kind, installUrl)}
        disabled={busy !== null}
        type="button"
      >
        <span className={`w-ic ${kind}`}>{letter}</span>
        <span className="w-meta">
          <span className="w-name">{name}</span>
          <span className="w-state">{installed ? note : "Not detected · install"}</span>
        </span>
        <span className="w-arrow">
          {busy === kind ? <span className="spinner" /> : installed ? <ChevronRight /> : <ExternalLink />}
        </span>
      </button>
    );
  }

  const detected = (kind: WalletKind) => Boolean(wallets.find((wallet) => wallet.kind === kind)?.provider);

  return (
    <div className="land">
      <div className="land-glow" />
      <div className="land-glow b" />

      <nav className="land-nav">
        <Brand />
        <div className="land-nav-links">
          <a href="#engine">Engine</a>
          <a href="#risk">Risk</a>
          <a href="#how">How it works</a>
          <a href="#lab">Backtest</a>
        </div>
        <div className="row gap8">
          <ThemeToggle />
          <a className="btn btn-primary" href="#access">
            Open terminal
            <ArrowRight />
          </a>
        </div>
      </nav>

      <section className="land-hero">
        <div>
          <div className="hero-kicker">
            <Sparkles />
            Meteora DLMM · DAMM v2 · Solana
          </div>
          <h1 className="hero-title">
            Liquidity on <span className="grad">autopilot</span>.
            <br />
            With a handbrake.
          </h1>
          <p className="hero-sub">
            Tide scans <strong>Meteora&apos;s live pools</strong>, scores the risk, chooses the strategy and
            runs an LP desk inside limits you set. Paper trading by default. Live execution only after a
            signed, time-boxed arming — with keys that never leave the encrypted signer.
          </p>
          <div className="hero-cta">
            <a className="btn btn-primary btn-lg" href="#access">
              <Wallet />
              Connect wallet
            </a>
            <a className="btn btn-lg btn-outline" href="#engine">
              See the engine
              <ChevronRight />
            </a>
          </div>
          <div className="hero-proof">
            <div className="proof">
              <div className="pv">
                2<span className="dim"> protocols</span>
              </div>
              <div className="pl">DLMM + DAMM v2</div>
            </div>
            <div className="proof">
              <div className="pv">
                $0<span className="dim"> exposure</span>
              </div>
              <div className="pl">Until you arm live</div>
            </div>
            <div className="proof">
              <div className="pv">
                24<span className="dim">h</span>
              </div>
              <div className="pl">Signed live window</div>
            </div>
            <div className="proof">
              <div className="pv">
                0<span className="dim"> keys exported</span>
              </div>
              <div className="pl">Encrypted signer</div>
            </div>
          </div>
        </div>

        <div className="hero-panel" id="access">
          <Bins />
          <div className="auth-card">
            <div className="auth-head">
              <div className="eyebrow">Wallet authentication</div>
              <div className="auth-title">Enter the terminal</div>
              <div className="auth-sub">
                Sign a gasless message to prove wallet ownership. Tide never asks for your seed phrase.
              </div>
            </div>
            <div className="wallet-list">
              {walletRow("phantom", "Phantom", "P", "https://phantom.app/download", detected("phantom"), "Detected · signature only")}
              {walletRow("solflare", "Solflare", "S", "https://solflare.com/download", detected("solflare"), "Detected · signature only")}
              {walletRow("backpack", "Backpack", "B", "https://backpack.app/download", detected("backpack"), "Detected · signature only")}
              {walletRow("injected", "Browser wallet", "◎", "https://solana.com/ecosystem", detected("injected"), "Detected · signature only")}
            </div>
            {error ? <div className="auth-error">{error}</div> : null}
            {devLoginEnabled ? (
              <Button
                variant="outline"
                className="dev-login"
                onClick={devLogin}
                loading={busy === "dev"}
              >
                <Terminal />
                Continue in local demo mode
              </Button>
            ) : null}
            <div className="auth-note">
              <LockKeyhole />
              <span>
                Authentication only — no transaction and no network fee. The workspace opens in paper
                mode with a simulated book. Live trading is off until explicitly enabled.
              </span>
            </div>
            <div className="auth-fine">By continuing you accept the risk disclaimer below.</div>
          </div>
        </div>
      </section>

      <section className="land-section" id="engine">
        <div className="section-head">
          <div className="sh-copy">
            <div className="eyebrow">The engine</div>
            <h2 className="section-title">An LP desk that shows its work.</h2>
            <p className="section-sub">
              Every scan, entry, rebalance and exit is explainable. Data comes from Meteora&apos;s official
              indexed APIs and RugCheck — not a static seed file.
            </p>
          </div>
          <Link className="btn btn-outline" href="/dashboard">
            Explore the console
            <ArrowRight />
          </Link>
        </div>
        <div className="feature-grid">
          {FEATURES.map((feature, index) => (
            <article className="feature" key={feature.title}>
              <div className="f-ic">
                <feature.icon />
              </div>
              <span className="f-num">0{index + 1}</span>
              <h3>{feature.title}</h3>
              <p>{feature.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="land-section tight" id="risk">
        <div className="section-head">
          <div className="sh-copy">
            <div className="eyebrow">Safety architecture</div>
            <h2 className="section-title">Four gates between a signal and your capital.</h2>
          </div>
        </div>
        <div className="grid g4 as-2">
          <div className="panel">
            <div className="panel-body">
              <div className="row between">
                <span className="badge tone-accent">Gate 01</span>
                <ShieldCheck size={17} style={{ color: "var(--accent)" }} />
              </div>
              <h3 className="h3 mt12">Token safety</h3>
              <p className="sub mt8">
                RugCheck supply, holders, authorities and liquidity checks block dangerous pools before
                they reach the strategy engine.
              </p>
            </div>
          </div>
          <div className="panel">
            <div className="panel-body">
              <div className="row between">
                <span className="badge tone-cyan">Gate 02</span>
                <Gauge size={17} style={{ color: "var(--cyan)" }} />
              </div>
              <h3 className="h3 mt12">Mandate limits</h3>
              <p className="sub mt8">
                Per-pool caps, total exposure, position count, stop-loss, take-profit, daily loss and
                drawdown halts apply to every action.
              </p>
            </div>
          </div>
          <div className="panel">
            <div className="panel-body">
              <div className="row between">
                <span className="badge tone-amber">Gate 03</span>
                <LockKeyhole size={17} style={{ color: "var(--amber)" }} />
              </div>
              <h3 className="h3 mt12">Encrypted signer</h3>
              <p className="sub mt8">
                Live transactions are signed server-side by a dedicated hot wallet encrypted with
                AES-256-GCM. The key cannot be read back or exported.
              </p>
            </div>
          </div>
          <div className="panel">
            <div className="panel-body">
              <div className="row between">
                <span className="badge tone-red">Gate 04</span>
                <Activity size={17} style={{ color: "var(--red)" }} />
              </div>
              <h3 className="h3 mt12">Kill switch</h3>
              <p className="sub mt8">
                One control pauses every bot, disarms live trading and — with an emergency signature —
                closes live positions. Nothing resumes automatically.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="land-section" id="how">
        <div className="section-head">
          <div className="sh-copy">
            <div className="eyebrow">How it works</div>
            <h2 className="section-title">From simulation to signed execution.</h2>
          </div>
        </div>
        <div className="steps">
          {STEPS.map((step) => (
            <div className="step" key={step.title}>
              <h4>{step.title}</h4>
              <p>{step.copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="land-section tight" id="lab">
        <div className="land-cta">
          <div>
            <div className="eyebrow">Start without risk</div>
            <h2>
              Open the desk.
              <br />
              Prove the strategy first.
            </h2>
            <p>
              Run a backtest on real candles, let the bot trade a simulated book, then decide if live
              execution deserves to be armed.
            </p>
          </div>
          <a className="btn btn-primary btn-lg" href="#access">
            Connect wallet
            <ArrowRight />
          </a>
        </div>
      </section>

      <footer className="land-foot">
        <div className="land-foot-inner">
          <div>
            <Brand />
            <p className="risk-disclaimer mt12">
              Tide is experimental software for managing concentrated liquidity. Providing liquidity can
              lose money through price volatility, impermanent loss, smart-contract risk and token risk.
              Nothing here is financial advice. Live execution requires a dedicated RPC, a funded
              encrypted execution wallet and a signed arming window. Use at your own risk.
            </p>
          </div>
          <p>
            Built with official Meteora SDKs and indexed APIs.
            <br />
            Solana mainnet-beta · Paper first.
          </p>
        </div>
      </footer>
    </div>
  );
}

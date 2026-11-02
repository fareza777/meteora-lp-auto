"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import {
  Activity,
  Bot,
  ChevronRight,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Radar,
  Settings,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { UserRecord } from "@/lib/types";
import { shortAddress } from "@/lib/client/format";
import { apiPost } from "@/lib/client/api";
import { Brand } from "../brand";
import { ThemeToggle } from "../theme-toggle";
import { CopyButton, Modal } from "../ui";
import { useToast } from "../toast";

const NAV = [
  { href: "/dashboard", label: "Desk", icon: LayoutDashboard, section: "Command" },
  { href: "/scanner", label: "Pool scanner", icon: Radar, section: "Command" },
  { href: "/positions", label: "Positions", icon: Wallet, section: "Command" },
  { href: "/bots", label: "Autopilot", icon: Bot, section: "Command" },
  { href: "/backtest", label: "Backtest lab", icon: FlaskConical, section: "Research" },
  { href: "/activity", label: "Activity", icon: Activity, section: "Research" },
  { href: "/settings", label: "Settings", icon: Settings, section: "System" },
];

const TITLES: Record<string, string> = {
  "/dashboard": "Desk overview",
  "/scanner": "Pool scanner",
  "/positions": "Positions",
  "/bots": "Autopilot",
  "/backtest": "Backtest lab",
  "/activity": "Activity",
  "/settings": "Settings",
};

const MOBILE = [
  { href: "/dashboard", label: "Desk", icon: LayoutDashboard },
  { href: "/scanner", label: "Scan", icon: Radar },
  { href: "/positions", label: "Positions", icon: Wallet },
  { href: "/bots", label: "Bots", icon: Bot },
];

const MORE = [
  { href: "/backtest", label: "Backtest lab", icon: FlaskConical, sub: "Replay a strategy on real candles" },
  { href: "/activity", label: "Activity", icon: Activity, sub: "Every bot decision and transaction" },
  { href: "/settings", label: "Settings", icon: Settings, sub: "Risk, notifications and live execution" },
];

export function AppShell({
  user,
  liveEnabled,
  children,
}: {
  user: UserRecord;
  liveEnabled: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const toast = useToast();
  const [moreOpen, setMoreOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { data: me } = useSWR<{ user: UserRecord | null; liveEnabled: boolean }>("/api/auth/me", {
    refreshInterval: 30_000,
    keepPreviousData: true,
  });

  const currentUser = me?.user ?? user;
  const currentLiveEnabled = me?.liveEnabled ?? liveEnabled;

  const title = TITLES[pathname] ?? "Tide";
  const section = NAV.find((item) => item.href === pathname)?.section ?? "Desk";
  const moreActive = ["/backtest", "/activity", "/settings"].includes(pathname);

  async function signOut() {
    setSigningOut(true);
    try {
      await apiPost("/api/auth/logout");
      window.location.assign("/");
    } catch {
      toast.error("Could not sign out", "Refresh the page and try again.");
      setSigningOut(false);
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <nav className="side-nav" aria-label="Primary">
          {(["Command", "Research", "System"] as const).map((group) => (
            <div key={group}>
              <div className="side-section">{group}</div>
              {NAV.filter((item) => item.section === group).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`side-link ${pathname === item.href ? "active" : ""}`}
                >
                  <item.icon />
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-status">
            <div className="ss-row">
              <span>Execution</span>
              <strong className="row gap4">
                <span
                  className={`dot ${currentUser.killSwitch ? "red" : currentUser.liveArmed ? "amber" : "green"}`}
                />
                {currentUser.killSwitch ? "Kill switch" : currentUser.liveArmed ? "Live armed" : "Paper"}
              </strong>
            </div>
            <div className="ss-row">
              <span>Server live</span>
              <strong>{currentLiveEnabled ? "Enabled" : "Disabled"}</strong>
            </div>
            <div className="ss-row">
              <span>Signer</span>
              <strong>{currentUser.liveArmed ? "Armed 24h" : "Sealed"}</strong>
            </div>
          </div>
          <div className="side-user">
            <span className="avatar">{currentUser.authWallet.slice(0, 2).toUpperCase()}</span>
            <div className="su-meta">
              <div className="su-name">{shortAddress(currentUser.authWallet, 5)}</div>
              <div className="su-addr">Wallet auth</div>
            </div>
            <button
              className="icon-btn"
              onClick={signOut}
              disabled={signingOut}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <span className="dim">{section}</span>
            <span className="sep">/</span>
            <span className="crumb truncate">{title}</span>
          </div>
          <div className="topbar-actions">
            <span
              className={`pill-live ${currentUser.killSwitch ? "halted" : currentUser.liveArmed ? "armed" : ""}`}
              title={
                currentUser.killSwitch
                  ? "Kill switch is engaged"
                  : currentUser.liveArmed
                    ? "Live execution is armed"
                    : "All activity is simulated"
              }
            >
              {currentUser.liveArmed && !currentUser.killSwitch ? (
                <span className="live-dot" />
              ) : (
                <ShieldCheck size={11} />
              )}
              {currentUser.killSwitch ? "Halted" : currentUser.liveArmed ? "Live armed" : "Paper"}
            </span>
            <ThemeToggle />
            <Link href="/settings" className="icon-btn" title="Live execution settings" aria-label="Live execution settings">
              <ShieldCheck />
            </Link>
          </div>
        </header>

        {children}
      </div>

      <nav className="mobile-nav" aria-label="Mobile">
        {MOBILE.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`mnav-link ${pathname === item.href ? "active" : ""}`}
          >
            <item.icon />
            {item.label}
          </Link>
        ))}
        <button
          className={`mnav-link ${moreActive ? "active" : ""}`}
          onClick={() => setMoreOpen(true)}
          type="button"
        >
          <MoreHorizontal />
          More
        </button>
      </nav>

      <Modal
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="More"
        subtitle={shortAddress(currentUser.authWallet, 6)}
        size="sm"
      >
        <div className="wallet-list">
          {MORE.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="wallet-btn"
              onClick={() => setMoreOpen(false)}
            >
              <span className="w-ic">
                <item.icon size={14} />
              </span>
              <span className="w-meta">
                <span className="w-name">{item.label}</span>
                <span className="w-state">{item.sub}</span>
              </span>
              <span className="w-arrow">
                <ChevronRight />
              </span>
            </Link>
          ))}
        </div>
        <div className="mt16 row between">
          <CopyButton value={currentUser.authWallet} label={shortAddress(currentUser.authWallet, 6)} />
          <button className="btn btn-ghost btn-sm" onClick={signOut} disabled={signingOut}>
            <LogOut />
            Sign out
          </button>
        </div>
      </Modal>
    </div>
  );
}

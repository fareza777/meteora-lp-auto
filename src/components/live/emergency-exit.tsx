"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import type { LiveReadiness, TradingMode } from "@/lib/types";
import { apiPost, errorMessage } from "@/lib/client/api";
import { signLiveAction } from "@/lib/client/live";
import { Button, Modal, Segmented } from "../ui";
import { useToast } from "../toast";

export function EmergencyExitModal({
  open,
  onClose,
  authWallet,
  liveReadiness,
  paperOpen,
  liveOpen,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  authWallet: string;
  liveReadiness: LiveReadiness | null;
  paperOpen: number;
  liveOpen: number;
  onDone: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<TradingMode>("paper");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode(liveOpen > 0 ? "live" : "paper");
      setConfirmed(false);
      setError(null);
    }
  }, [open, liveOpen]);

  async function execute() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "live") {
        if (!liveReadiness?.wallet) {
          throw new Error("No execution wallet is configured.");
        }
        const { nonce, signature } = await signLiveAction("emergency-exit", authWallet);
        const outcome = await apiPost<{ closed: number; errors: string[] }>("/api/positions/exit-all", {
          mode: "live",
          nonce,
          signature,
        });
        toast.success(
          "Emergency exit executed",
          `${outcome.closed} live position(s) closed. Kill switch engaged.`,
        );
      } else {
        const outcome = await apiPost<{ closed: number; errors: string[] }>("/api/positions/exit-all", {
          mode: "paper",
        });
        toast.success("Paper book flattened", `${outcome.closed} position(s) closed. All bots paused.`);
      }
      setConfirmed(false);
      onDone();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
      toast.fromError("Emergency exit failed", caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Emergency exit"
      subtitle="Flatten a book immediately. This action is logged and pauses every bot."
      icon={<ShieldAlert />}
      footer={
        <div className="row between w-full">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={execute}
            loading={busy}
            disabled={!confirmed || (mode === "live" && !liveReadiness?.wallet)}
          >
            {mode === "live" ? "Sign & close live book" : "Close paper book"}
          </Button>
        </div>
      }
    >
      <Segmented
        value={mode}
        onChange={(value) => {
          setMode(value);
          setConfirmed(false);
          setError(null);
        }}
        options={[
          { value: "paper" as TradingMode, label: `Paper · ${paperOpen} open` },
          { value: "live" as TradingMode, label: `Live · ${liveOpen} open` },
        ]}
        ariaLabel="Book to close"
      />

      <div className={`notice ${mode === "live" ? "danger" : "warn"}`} style={{ marginTop: 14 }}>
        <TriangleAlert />
        <span>
          {mode === "live"
            ? "Live positions are closed through signed transactions at market. A fresh wallet signature is required. The kill switch engages afterwards and live stays disarmed."
            : "Paper positions are closed at the current simulated mark. All bots are paused; no on-chain transaction occurs."}
        </span>
      </div>

      {mode === "live" && liveOpen === 0 ? (
        <div className="hint mt12">
          There are no open live positions. Signing still engages the kill switch and pauses every bot.
        </div>
      ) : null}

      {error ? (
        <div className="notice danger mt12">
          <TriangleAlert />
          <span>{error}</span>
        </div>
      ) : null}

      <label className="check mt16">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>
          I understand this closes {mode === "live" ? "real" : "simulated"} positions immediately and
          stops the autopilot.
        </span>
      </label>
    </Modal>
  );
}

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { isLiveGloballyEnabled } from "@/lib/config";
import { AppShell } from "@/components/shell/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser().catch(() => null);
  if (!user) redirect("/");
  const liveEnabled = (() => {
    try {
      return isLiveGloballyEnabled();
    } catch {
      return false;
    }
  })();
  return (
    <AppShell user={user} liveEnabled={liveEnabled}>
      {children}
    </AppShell>
  );
}

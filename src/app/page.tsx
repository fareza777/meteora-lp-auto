import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Landing } from "@/components/landing";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser().catch(() => null);
  if (user) redirect("/dashboard");
  const devLoginEnabled =
    process.env.NODE_ENV !== "production" && process.env.DEV_LOGIN_ENABLED === "true";
  return <Landing devLoginEnabled={devLoginEnabled} />;
}

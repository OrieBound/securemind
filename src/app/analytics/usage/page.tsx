import { AppShell } from "@/components/app/app-shell";
import { AuthGate } from "@/components/app/auth-gate";

export default function UsageAnalyticsPage() {
  return (
    <AuthGate>
      <AppShell analyticsView="usage" />
    </AuthGate>
  );
}

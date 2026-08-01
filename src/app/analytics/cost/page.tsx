import { AppShell } from "@/components/app/app-shell";
import { AuthGate } from "@/components/app/auth-gate";

export default function CostAnalyticsPage() {
  return (
    <AuthGate>
      <AppShell analyticsView="cost" />
    </AuthGate>
  );
}

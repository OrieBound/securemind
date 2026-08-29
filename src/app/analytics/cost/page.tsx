import { Suspense } from "react";
import { AppShell } from "@/components/app/app-shell";
import { AuthGate } from "@/components/app/auth-gate";

export default function CostAnalyticsPage() {
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <AppShell analyticsView="cost" />
      </Suspense>
    </AuthGate>
  );
}

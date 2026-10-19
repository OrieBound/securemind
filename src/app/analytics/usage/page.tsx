import { Suspense } from "react";
import { AppShell } from "@/components/app/app-shell";
import { AuthGate } from "@/components/app/auth-gate";

export default function UsageAnalyticsPage() {
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <AppShell analyticsView="usage" />
      </Suspense>
    </AuthGate>
  );
}

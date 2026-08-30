import { Suspense } from "react";
import { AuthGate } from "@/components/app/auth-gate";
import { GettingStartedGuide } from "@/components/app/getting-started-guide";
import { runtimeEdition } from "@/lib/runtime-env";

export default function GettingStartedPage() {
  const edition = runtimeEdition();
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <GettingStartedGuide edition={edition} />
      </Suspense>
    </AuthGate>
  );
}

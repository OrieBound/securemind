"use client";

import { ProductMark } from "@/components/app/product-mark";
import { PRODUCT_NAME } from "@/lib/branding";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-background px-4">
      <div role="alert" className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-md">
        <ProductMark size={40} className="mx-auto" />
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">{PRODUCT_NAME}</p>
        <h1 className="mt-1 text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page hit an unexpected error. Your messages and files are not affected.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Try again
        </button>
      </div>
    </main>
  );
}

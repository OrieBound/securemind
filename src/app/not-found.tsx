import { ProductMark } from "@/components/app/product-mark";
import { PRODUCT_NAME } from "@/lib/branding";

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-md">
        <ProductMark size={40} className="mx-auto" />
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">{PRODUCT_NAME}</p>
        <h1 className="mt-1 text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          That page does not exist or has moved.
        </p>
        <a
          href="/"
          className="mt-5 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Back to workspace
        </a>
      </div>
    </main>
  );
}

import { PRODUCT_LOGO_SRC, PRODUCT_NAME } from "@/lib/branding";
import { cn } from "@/lib/utils";

/** Product mark from `/public/brand`. Decorative when the wordmark sits beside it. */
export function ProductMark({
  size = 40,
  className,
  decorative = true,
}: {
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <img
      src={PRODUCT_LOGO_SRC}
      alt={decorative ? "" : PRODUCT_NAME}
      width={size}
      height={size}
      className={cn("rounded-2xl object-cover", className)}
      decoding="async"
    />
  );
}

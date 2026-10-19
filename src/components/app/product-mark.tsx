import { PRODUCT_LOGO_SRC, PRODUCT_NAME } from "@/lib/branding";
import { cn } from "@/lib/utils";

/** Product mark from `/public/brand`, or a custom portal logo in the same slot. */
export function ProductMark({
  size = 40,
  className,
  decorative = true,
  src = null,
  onError,
}: {
  size?: number;
  className?: string;
  decorative?: boolean;
  /** Custom portal logo. Null uses the SecureMind mark. */
  src?: string | null;
  onError?: () => void;
}) {
  return (
    <img
      src={src || PRODUCT_LOGO_SRC}
      alt={decorative ? "" : PRODUCT_NAME}
      width={size}
      height={size}
      className={cn("rounded-2xl object-cover", className)}
      decoding="async"
      onError={src ? onError : undefined}
    />
  );
}

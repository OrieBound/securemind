import { notFound } from "next/navigation";
import { MemoryPreview } from "./preview";

/** Layout review page with sample data. Not available in production builds. */
export default function MemoryPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MemoryPreview />;
}

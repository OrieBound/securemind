import { notFound } from "next/navigation";
import { ThinkingPreview } from "./preview";

/** Loading-indicator review page. Not available in production builds. */
export default function ThinkingPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ThinkingPreview />;
}

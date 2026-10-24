import { notFound } from "next/navigation";
import { FilePreview } from "./preview";

/** File-card review page with sample replies. Not available in production builds. */
export default function FilePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FilePreview />;
}

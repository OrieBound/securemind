import type { Metadata } from "next";
import { ThemeProvider } from "@/components/app/theme-provider";
import { PRODUCT_DESCRIPTION, PRODUCT_TITLE } from "@/lib/branding";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: PRODUCT_TITLE,
  description: PRODUCT_DESCRIPTION,
  icons: {
    icon: [{ url: "/brand/securemind-logo.png", type: "image/png" }],
    apple: "/brand/securemind-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Apply saved theme before first paint — dark is the default. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}

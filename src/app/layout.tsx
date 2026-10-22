// Root layout: global styles and page metadata only.
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Buzz PoC chat",
  description: "Send a message and watch it get delivered to Telegram.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}

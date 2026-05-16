import type { Metadata } from "next";
import "./globals.css";
import FeedbackChatClient from "./feedback-chat-client";

export const metadata: Metadata = {
  title: "shlomBait",
  description: "Async family conflict resolution - each side logs feelings privately, shared view with Claude-powered mitigation suggestions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}
        <FeedbackChatClient />
</body>
    </html>
  );
}

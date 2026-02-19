import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MIND GAME | Tactical Strategy",
  description: "A high-stakes tactical board game of spread, control, and neutralization. Challenge your friends in real-time.",
  openGraph: {
    title: "MIND GAME | Tactical Strategy",
    description: "Neutralize the Resistance or protect it. A tactical battle of wits.",
    type: "website",
    siteName: "Mind Game Prototype",
    images: [
      {
        url: "/icon.png",
        width: 1024,
        height: 1024,
        alt: "Mind Game Art",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MIND GAME",
    description: "A futuristic tactical board game.",
    images: ["/icon.png"],
  },
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

import { Toaster } from "@/components/ui/sonner";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Toaster position="top-center" richColors theme="dark" />
      </body>
    </html>
  );
}

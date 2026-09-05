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

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://aforden.aformix.com";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "Aforden — Field Service Management & Dispatch Software",
    template: "%s | Aforden",
  },
  description:
    "Aforden is a modern field service operations platform for dispatch, scheduling, work orders, invoicing, and technician management.",
  applicationName: "Aforden",
  keywords: [
    "field service management",
    "dispatch software",
    "work order management",
    "technician tracking",
    "service invoicing",
    "scheduling software",
  ],
  authors: [{ name: "Aforden Team" }],
  creator: "Aforden",
  publisher: "Aforden",
  alternates: {
    canonical: "./",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "./",
    siteName: "Aforden",
    title: "Aforden — Field Service Management & Dispatch Software",
    description:
      "Aforden is a modern field service operations platform for dispatch, scheduling, work orders, invoicing, and technician management.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Aforden — Field Service Management Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Aforden — Field Service Management & Dispatch Software",
    description:
      "Aforden is a modern field service operations platform for dispatch, scheduling, work orders, invoicing, and technician management.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/favicon.ico",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

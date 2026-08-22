import type { Metadata } from "next";
import Script from "next/script";
import { Manrope } from "next/font/google";
import "./globals.css";
import { Providers } from "./(app)/_components/Providers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth";


const manrope = Manrope({
  variable: "--font-Manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://comparta.xyz"),
  title: {
    default: "Comparta - Smart Financial Operating System for Teams",
    template: "%s | Comparta",
  },
  description:
    "Comparta is the all-in-one financial OS for modern teams: send USDC payments, issue invoices, run payroll, create payment links, allocate balances, earn yield on savings, and gain AI-powered spending insights - all on one secure, onchain platform.",
  keywords: [
    "Comparta",
    "USDC payments",
    "stablecoin payroll",
    "crypto invoicing",
    "payment links",
    "onchain finance",
    "financial OS",
    "Arc blockchain",
    "Circle wallets",
    "smart savings USYC",
    "DCA crypto",
    "spending insights",
    "team finance",
    "business banking alternative",
  ],
  authors: [{ name: "Comparta", url: "https://comparta.xyz" }],
  creator: "Comparta",
  publisher: "Comparta",
  applicationName: "Comparta",
  generator: "Next.js",
  category: "Finance",
  classification: "Finance / Payments / SaaS",

  icons: {
    icon: [
      {
        url: "/favicon_io/favicon.ico",
        sizes: "any",
      },
      {
        url: "/favicon_io/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
      {
        url: "/favicon_io/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/favicon_io/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    shortcut: ["/favicon_io/favicon.ico"],
    other: [
      {
        rel: "manifest",
        url: "/favicon_io/site.webmanifest",
      },
    ],
  },

  manifest: "/favicon_io/site.webmanifest",

  alternates: {
    canonical: "/",
  },

  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://comparta.xyz",
    siteName: "Comparta",
    title: "Comparta - Smart Financial Operating System for Teams",
    description:
      "Send, receive, and manage USDC with your team. Invoicing, payroll, payment links, automated allocations, yield on savings, DCA, and AI-driven insights - unified onchain.",
    images: [
      {
        url: "/IMG-20260716-WA0038.jpg",
        width: 1200,
        height: 630,
        alt: "Comparta - Financial OS for Modern Teams",
        type: "image/jpeg",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    site: "@comparta",
    creator: "@comparta",
    title: "Comparta - Smart Financial Operating System for Teams",
    description:
      "Send, receive, and manage USDC with your team. Invoicing, payroll, payment links, automated allocations, yield on savings, DCA, and AI-driven insights - unified onchain.",
    images: [
      {
        url: "/IMG-20260716-WA0038.jpg",
        alt: "Comparta - Financial OS for Modern Teams",
      },
    ],
  },

  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },

  formatDetection: {
    telephone: false,
    email: false,
    address: false,
    date: false,
    url: false,
  },

};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en" className={`${manrope.variable} h-full antialiased`}>
      <body className={`${manrope.className} min-h-full flex flex-col`}>
        <Providers session={session}>{children}</Providers>
      </body>
      <Script
        src="https://cdn.lordicon.com/lordicon.js"
        strategy="afterInteractive"
      />
    </html>
  );
}
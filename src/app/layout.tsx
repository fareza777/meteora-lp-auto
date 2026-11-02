import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Tide — Meteora liquidity terminal",
    template: "%s · Tide",
  },
  description:
    "Autonomous Meteora DLMM and DAMM v2 liquidity management: smart pool scanner, strategy engine, risk-gated execution, paper trading and backtesting.",
  applicationName: "Tide",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f1eee5",
  colorScheme: "light dark",
};

const themeScript = `(function(){try{var t=localStorage.getItem("tide-theme");if(t!=="light"&&t!=="dark")t="light";document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="dark"?"#05070a":"#f1eee5")}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

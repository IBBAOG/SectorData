import type { Metadata, Viewport } from "next";
import "bootstrap/dist/css/bootstrap.min.css";
import "./globals.css";
import ServiceWorkerRegister from "../components/ServiceWorkerRegister";

// Favicon: served by Next.js file-system convention from src/app/icon.png (black drop).
// Do NOT re-add an `icons: {}` block in metadata OR a src/app/favicon.ico file — both will silently override icon.png.
// Regression hunted on 2026-05-27.
export const metadata: Metadata = {
  title: "O&G Data",
  description: "Analytics dashboard",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SectorData",
  },
};

export const viewport: Viewport = {
  themeColor: "#ff5000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

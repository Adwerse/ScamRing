import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from '@/components/SiteHeader';
import Link from 'next/link';

export const metadata: Metadata = {
  title: "ScamRing",
  description: "Check a rental listing against a shared graph of scam reports.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <SiteHeader />
        <main id="main-content" className="site-main">{children}</main>
        {/* Lane D owns components/AlertToast.tsx. Mount its exported component here when delivered. */}
        <footer className="site-footer"><div><Link href="/" className="brand">ScamRing<span className="brand-dot">.</span></Link><p>A little more evidence. A better next step.</p></div><div><p>Shared contact hints are masked. Your listing is submitted for analysis.</p><p>Rent data: CSO table RIQ02. <Link href="/under-the-hood">See how it works →</Link></p></div></footer>
      </body>
    </html>
  );
}

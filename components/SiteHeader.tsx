'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function SiteHeader() {
  const path = usePathname();
  return <header className="site-header"><Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">◎</span>ScamRing<span className="brand-dot">.</span></Link><nav aria-label="Main navigation">{[{ href: '/', label: 'Check a listing' }, { href: '/live', label: 'Live' }, { href: '/under-the-hood', label: 'Under the hood' }, { href: '/moderate', label: 'Moderate' }].map(link => <Link key={link.href} href={link.href} aria-current={path === link.href ? 'page' : undefined}>{link.label}</Link>)}</nav><span className="header-tag">Built for students</span></header>;
}

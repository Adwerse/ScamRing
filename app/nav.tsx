import Link from 'next/link';

const LINKS = [
  { href: '/', label: 'Check' },
  { href: '/moderate', label: 'Moderate' },
  { href: '/live', label: 'Live' },
  { href: '/under-the-hood', label: 'Under the hood' },
];

export function Nav() {
  return (
    <nav className="flex items-center gap-6 border-b border-neutral-200 px-6 py-3 text-sm">
      <Link href="/" className="font-bold">
        ScamRing
      </Link>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="text-neutral-600 hover:text-black">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

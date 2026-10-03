// Pulls contact identifiers out of listing text and hashes them. Raw values never leave this
// module: callers get 'kind:<hmac>' strings, masked hints (see maskHint)
// and the text with every identifier replaced by '[phone]', '[email]', '[pay]' or '[iban]'.
import { createHmac } from 'node:crypto';
import type { IdentifierHint } from '@/lib/types';

type Kind = 'phone' | 'email' | 'pay' | 'iban';
type Found = { kind: Kind; value: string };

/** Total IBAN length per country; unknown countries are ignored to avoid false positives. */
const IBAN_LENGTHS: Record<string, number> = {
  IE: 22, GB: 22, DE: 22, FR: 27, ES: 24, IT: 27, NL: 18, BE: 16, PT: 25, LT: 20, LV: 21,
  PL: 28, LU: 20, AT: 20, CH: 21, DK: 18, SE: 24, NO: 15, FI: 18, MT: 31,
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const IBAN_RE = /\b([A-Za-z]{2})(\d{2}(?: ?[A-Za-z0-9]){11,30})\b/g;
const REVOLUT_URL_RE = /(?:https?:\/\/)?(?:www\.)?revolut\.me\/@?([A-Za-z0-9_.-]+)/gi;
const REVOLUT_AT_RE = /(?<![\w@.])@([A-Za-z0-9_.-]{2,30})/g;

const MAX_PHONE_DIGITS = 17;
const SEPARATORS = ' ().-';

export function hashIdentifier(kind: Kind, normalised: string): string {
  const secret = process.env.IDENTIFIER_SECRET;
  if (!secret) throw new Error('IDENTIFIER_SECRET is not set');
  return `${kind}:${createHmac('sha256', secret).update(normalised).digest('hex')}`;
}

/** Replaces every match of `re` that `normalise` accepts with '[kind]', recording the value. */
function take(text: string, re: RegExp, kind: Kind, normalise: (...groups: string[]) => string | null, found: Found[]): string {
  return text.replace(re, (match: string, ...groups: string[]) => {
    const value = normalise(match, ...groups);
    if (!value) return match;
    found.push({ kind, value });
    return `[${kind}]`;
  });
}

function normaliseIban(_match: string, country: string, rest: string): string | null {
  const expected = IBAN_LENGTHS[country.toUpperCase()];
  const compact = (country + rest).replace(/ /g, '').toUpperCase();
  return expected && compact.length >= expected ? compact.slice(0, expected) : null;
}

function normaliseHandle(_match: string, handle: string): string | null {
  const clean = handle.toLowerCase().replace(/[.-]+$/, '');
  return clean.length >= 2 ? clean : null;
}

/** Reads digits from `start`, allowing up to 2 separators between digits; `ends[k]` is the index after digit k. */
function scanDigits(s: string, start: number): { digits: string; ends: number[] } {
  let digits = '';
  const ends: number[] = [];
  let gap = 0;
  for (let i = start; i < s.length && digits.length < MAX_PHONE_DIGITS; i++) {
    if (/\d/.test(s[i])) {
      digits += s[i];
      ends.push(i + 1);
      gap = 0;
    } else if (SEPARATORS.includes(s[i]) && digits.length > 0 && ++gap <= 2) continue;
    else break;
  }
  return { digits, ends };
}

type Phone = { e164: string; end: number };

/** Reads a number starting at `i` (a digit, or '+'): Irish 08x, UK 07, 00/+ international. */
function parsePhoneAt(s: string, i: number): Phone | null {
  const plus = s[i] === '+';
  const { digits, ends } = scanDigits(s, plus ? i + 1 : i);
  const take = (n: number, e164: string): Phone | null => (n <= digits.length ? { e164, end: ends[n - 1] } : null);
  const international = plus || digits.startsWith('00');
  if (!international) {
    if (/^08[3-9]/.test(digits)) return take(10, `+353${digits.slice(1, 10)}`);
    if (/^07/.test(digits)) return take(11, `+44${digits.slice(1, 11)}`);
    return null;
  }
  const skip = plus ? 0 : 2;
  const d = digits.slice(skip);
  for (const [cc, length] of [['44', 10], ['353', 9]] as const) {
    if (!d.startsWith(cc)) continue;
    const trunk = d[cc.length] === '0' ? 1 : 0; // "+44 (0) 77..." and "+353 087..."
    const national = d.slice(cc.length + trunk, cc.length + trunk + length);
    const need = cc === '353' && !national.startsWith('8') ? 8 : length;
    if (national.length < need) return null;
    return take(skip + cc.length + trunk + national.length, `+${cc}${national}`);
  }
  const n = Math.min(d.length, 15);
  return n >= 8 && d[0] !== '0' ? take(skip + n, `+${d.slice(0, n)}`) : null;
}

/** Records every phone in `text` and returns the text with each replaced by '[phone]'. */
function takePhones(text: string, found: Found[]): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const startsNumber = /\d/.test(text[i]) ? !/\d/.test(text[i - 1] ?? '') : text[i] === '+' && /\d/.test(text[i + 1] ?? '');
    const phone = startsNumber ? parsePhoneAt(text, i) : null;
    if (!phone) {
      out += text[i];
      continue;
    }
    found.push({ kind: 'phone', value: phone.e164 });
    out += '[phone]';
    i = phone.end - 1;
  }
  return out;
}

/**
 * A short, readable hint that never contains the raw value: '+353 ** *** 0193' (last 4 digits),
 * 'j***@e***.com' (first letters and the ending), '@d***ow' (first and last 2 characters),
 * 'IE** **** 5678' (country and last 4).
 */
export function maskHint(kind: Kind, value: string): string {
  if (kind === 'phone') {
    const country = value.match(/^\+(353|44|\d{1,3})/)?.[0] ?? '+';
    return `${country} ** *** ${value.slice(-4)}`;
  }
  if (kind === 'email') {
    const [local, domain = ''] = value.split('@');
    const dot = domain.lastIndexOf('.');
    return `${local[0]}***@${domain[0] ?? ''}***${dot === -1 ? '' : domain.slice(dot)}`;
  }
  if (kind === 'pay') return `@${value[0]}***${value.length > 4 ? value.slice(-2) : ''}`;
  return `${value.slice(0, 2)}** **** ${value.slice(-4)}`;
}

export function extractIdentifiers(text: string): { identifiers: string[]; hints: IdentifierHint[]; redactedText: string } {
  const found: Found[] = [];
  let redacted = take(text, EMAIL_RE, 'email', (m) => m.toLowerCase().trim(), found);
  redacted = take(redacted, IBAN_RE, 'iban', normaliseIban, found);
  redacted = take(redacted, REVOLUT_URL_RE, 'pay', normaliseHandle, found);
  redacted = take(redacted, REVOLUT_AT_RE, 'pay', normaliseHandle, found);
  redacted = takePhones(redacted, found);

  const seen = new Set<string>();
  const identifiers: string[] = [];
  const hints: IdentifierHint[] = [];
  for (const { kind, value } of found) {
    const id = hashIdentifier(kind, value);
    if (seen.has(id)) continue;
    seen.add(id);
    identifiers.push(id);
    hints.push({ kind, hint: maskHint(kind, value) });
  }
  return { identifiers, hints, redactedText: redacted };
}

// Browser-only form helpers. The frozen API accepts priceEur as monthly rent.
export type RentPeriod = 'weekly' | 'monthly' | 'yearly';
export interface DetectedRent { amount: number; period: RentPeriod; assumedMonthly: boolean }
export interface RentDetection { rent?: DetectedRent; needsReview: boolean }

export function monthlyRent(amount: number, period: RentPeriod): number {
  const value = period === 'weekly' ? amount * 52 / 12 : period === 'yearly' ? amount / 12 : amount;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseAmount(raw: string): number | undefined {
  let value = raw.replace(/\s/g, '');
  if (value.includes(',') && value.includes('.')) {
    value = value.lastIndexOf(',') > value.lastIndexOf('.') ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  } else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(value)) value = value.replace(/[.,]/g, '');
  else if (/^\d+,\d{1,2}$/.test(value)) value = value.replace(',', '.');
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

const periodToken = '(week(?:ly)?|wk|month(?:ly)?|mo|year(?:ly)?|yr|annum|annual(?:ly)?)';
function periodAt(before: string, after: string): RentPeriod | undefined {
  const suffix = new RegExp(`^\\s*(?:(?:per|a|each|every|/)\\s*)?${periodToken}\\b|^\\s*(pw|pcm|pm|pa)\\b`, 'i').exec(after);
  const prefix = /\b(weekly|monthly|yearly|annual)\s+(?:rent\s*)?(?:(?:is|of|at)\s*)?[:=]?\s*$/i.exec(before);
  const token = (suffix?.[1] ?? suffix?.[2] ?? prefix?.[1])?.toLowerCase();
  if (!token) return;
  return /^(week|wk|pw)/.test(token) ? 'weekly' : /^(year|yr|ann|pa)/.test(token) ? 'yearly' : 'monthly';
}

export function detectRent(text: string): RentDetection {
  const number = '\\d+(?:[.,]\\d+|[ \\u00a0]\\d{3})*';
  const currency = new RegExp(`(?:€|\\bEUR\\s*)\\s*(${number})|(${number})\\s*(?:€|euros?\\b|EUR\\b)`, 'gi');
  const candidates: DetectedRent[] = [];
  let monetaryAmounts = 0;
  for (const match of text.matchAll(currency)) {
    monetaryAmounts++;
    const amount = parseAmount(match[1] ?? match[2]);
    if (!amount) continue;
    const before = text.slice(Math.max(0, match.index! - 55), match.index);
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 45);
    // Deposits and bills are not recurring rent, even if they are the first amount.
    if (/\b(?:deposit|bills?|utilities|fees?)\s*(?:(?:is|of|at|for)\s*)?[:=]?\s*$/i.test(before)
      || /^\s*(?:deposit|for\s+(?:bills|utilities)|bills?|utilities|fee)\b/i.test(after)) continue;
    const period = periodAt(before, after);
    candidates.push({ amount, period: period ?? 'monthly', assumedMonthly: !period });
  }
  // Repeated mentions of the same rent are harmless; competing prices need review.
  const distinct = candidates.filter((item, index) => candidates.findIndex(other => other.amount === item.amount && other.period === item.period) === index);
  if (distinct.length !== 1) return { needsReview: monetaryAmounts > 0 };
  return { rent: distinct[0], needsReview: false };
}

export function postingUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) return;
    return url.href;
  } catch { return; }
}

export function isLinkOnlyMessage(text: string): boolean {
  return /https?:\/\/\S+/i.test(text) && !text.replace(/https?:\/\/\S+/gi, '').replace(/[\s.,;:!?()[\]]/g, '');
}

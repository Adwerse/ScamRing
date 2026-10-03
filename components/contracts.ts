// Browser-only wire types. Keep these aligned with CONTRACT.md and fixtures/.
export type Level = 'LOW' | 'MEDIUM' | 'HIGH';
export type Source = 'facebook' | 'whatsapp' | 'telegram' | 'daft' | 'other';
export type Status = 'pending' | 'confirmed_scam' | 'legit' | 'rejected';
export type IdentifierKind = 'phone' | 'email' | 'pay' | 'iban' | 'img';
export interface Signal { code: string; points: number; title: string; evidence: string; refs: string[] }
export interface Verdict { score: number; level: Level; signals: Signal[]; summary: string; computedAt: string }
export interface CheckResponse { reportId: string; verdict: Verdict; ring: { size: number; confirmedCount: number } }
export interface ReportResponse {
  _id: string; text: string; source: Source; area: string; kind: 'room' | 'whole';
  bedrooms: number | null; priceEur: number | null; status: Status;
  verdict?: Verdict; createdAt: string; identifierHints: { kind: IdentifierKind; hint: string }[];
}
export interface ReportNode { id: string; type: 'report'; area: string; priceEur: number | null; status: Status; hops: number; isCurrent: boolean }
export interface IdentifierNode { id: string; type: 'identifier'; kind: IdentifierKind; hint: string }
export type RingNode = ReportNode | IdentifierNode;
export interface RingResponse { nodes: RingNode[]; links: { source: string; target: string; kind: IdentifierKind }[]; stats: { reports: number; confirmed: number; maxHops: number } }
export interface ProofResponse {
  available: boolean; message?: string; empty?: boolean; ringPending?: boolean;
  counts?: Record<string, number>;
  indexes?: { collection: string; name: string; keys: Record<string, unknown> }[];
  searchIndexes?: { collection: string; name: string; status: string; queryable: boolean }[];
  scan?: { stage: string; indexName: string | null; keysExamined: number; documentsExamined: number };
  ring?: { reports: number; sharedIdentifiers: number; confirmed: number; maxHops: number };
}
export const statusLabel: Record<Status, string> = { pending: 'Awaiting review', confirmed_scam: 'Confirmed scam', legit: 'Marked legitimate', rejected: 'Rejected report' };
export const kindLabel: Record<IdentifierKind, string> = { phone: 'Phone', email: 'Email', pay: 'Payment handle', iban: 'IBAN', img: 'Photo' };
export function priceLabel(price: number | null | undefined) {
  return price == null ? 'Price unknown' : `${new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(price)} / month`;
}
export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  if (!response.ok) {
    if (response.status === 501) throw new Error('This endpoint is waiting for the team’s implementation. Please try again after the next backend push.');
    if (response.status === 404) throw new Error('This report could not be found. It may have expired or the demo database may have been reset.');
    if (response.status === 400 || response.status === 413 || response.status === 415) throw new Error('The listing could not be accepted. Check the text and photo formats and sizes, then try again.');
    throw new Error(`The service could not complete the request (${response.status}). Please try again.`);
  }
  return response.json();
}
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
export function isVerdict(value: unknown): value is Verdict {
  if (!value || typeof value !== 'object') return false;
  const v = value as Verdict;
  return ['LOW', 'MEDIUM', 'HIGH'].includes(v.level) && Number.isFinite(v.score) && v.score >= 0 && v.score <= 100 && typeof v.summary === 'string' && Array.isArray(v.signals) && v.signals.every(s => s && typeof s.code === 'string' && typeof s.title === 'string' && typeof s.evidence === 'string' && Number.isFinite(s.points) && Array.isArray(s.refs) && s.refs.every(ref => typeof ref === 'string'));
}
export function isRing(value: unknown): value is RingResponse {
  if (!value || typeof value !== 'object') return false;
  const ring = value as RingResponse;
  return Array.isArray(ring.nodes) && ring.nodes.every(n => n && typeof n.id === 'string' && (n.type === 'report' ? typeof n.area === 'string' && ['pending', 'confirmed_scam', 'legit', 'rejected'].includes(n.status) && (n.priceEur === null || Number.isFinite(n.priceEur)) && Number.isFinite(n.hops) : n.type === 'identifier' && ['phone', 'email', 'pay', 'iban', 'img'].includes(n.kind) && typeof n.hint === 'string')) && Array.isArray(ring.links) && ring.links.every(l => l && typeof l.source === 'string' && typeof l.target === 'string') && !!ring.stats && Number.isFinite(ring.stats.reports) && Number.isFinite(ring.stats.confirmed) && Number.isFinite(ring.stats.maxHops);
}

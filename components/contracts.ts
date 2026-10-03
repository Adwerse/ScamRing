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
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init?.signal?.aborted) controller.abort();
  else init?.signal?.addEventListener('abort', abort, { once: true });
  const isWrite = !!init?.method && init.method.toUpperCase() !== 'GET';
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, isWrite ? 60000 : 20000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    if (!response.ok) {
      if (response.status === 501) throw new Error('This endpoint is waiting for the team’s implementation. Please try again after the next backend push.');
      if (response.status === 404) throw new Error('This report could not be found. It may have expired or the demo database may have been reset.');
      if (response.status === 400 || response.status === 413 || response.status === 415) throw new Error('The listing could not be accepted. Check the text and photo formats and sizes, then try again.');
      throw new Error(`The service could not complete the request (${response.status}). Please try again.`);
    }
    return await response.json();
  } catch (error) {
    if (timedOut) throw new Error(isWrite
      ? 'The checker took too long to respond. Your listing may have been saved. Check your connection before submitting again.'
      : 'The request took too long to respond. Check your connection and try refreshing.');
    throw error;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener('abort', abort);
  }
}
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
export function isVerdict(value: unknown): value is Verdict {
  if (!value || typeof value !== 'object') return false;
  const v = value as Verdict;
  return ['LOW', 'MEDIUM', 'HIGH'].includes(v.level) && Number.isFinite(v.score) && v.score >= 0 && v.score <= 100 && typeof v.summary === 'string' && Array.isArray(v.signals) && v.signals.every(s => s && typeof s.code === 'string' && typeof s.title === 'string' && typeof s.evidence === 'string' && Number.isFinite(s.points) && Array.isArray(s.refs) && s.refs.every(ref => typeof ref === 'string'));
}
export function isReport(value: unknown): value is ReportResponse {
  if (!value || typeof value !== 'object') return false;
  const report = value as ReportResponse;
  return typeof report._id === 'string' && /^[a-f\d]{24}$/i.test(report._id)
    && typeof report.text === 'string' && typeof report.area === 'string'
    && ['room', 'whole'].includes(report.kind)
    && ['pending', 'confirmed_scam', 'legit', 'rejected'].includes(report.status)
    && ['facebook', 'whatsapp', 'telegram', 'daft', 'other'].includes(report.source)
    && (report.priceEur === null || Number.isFinite(report.priceEur))
    && (report.verdict === undefined || isVerdict(report.verdict));
}
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function isCheckResponse(value: unknown): value is CheckResponse {
  if (!isRecord(value) || !isRecord(value.ring)) return false;
  return typeof value.reportId === 'string' && /^[a-f\d]{24}$/i.test(value.reportId)
    && isVerdict(value.verdict) && isCount(value.ring.size) && value.ring.size >= 1
    && isCount(value.ring.confirmedCount) && value.ring.confirmedCount <= value.ring.size;
}
export function isRing(value: unknown): value is RingResponse {
  if (!value || typeof value !== 'object') return false;
  const ring = value as RingResponse;
  if (!Array.isArray(ring.nodes) || !ring.nodes.every(n => n && typeof n.id === 'string' && n.id.length > 0 && (n.type === 'report' ? /^[a-f\d]{24}$/i.test(n.id) && typeof n.area === 'string' && ['pending', 'confirmed_scam', 'legit', 'rejected'].includes(n.status) && (n.priceEur === null || Number.isFinite(n.priceEur)) && isCount(n.hops) && typeof n.isCurrent === 'boolean' : n.type === 'identifier' && ['phone', 'email', 'pay', 'iban', 'img'].includes(n.kind) && typeof n.hint === 'string'))) return false;
  const nodes = new Map(ring.nodes.map(node => [node.id, node]));
  if (nodes.size !== ring.nodes.length) return false;
  return Array.isArray(ring.links) && ring.links.every(link => {
    if (!link || typeof link.source !== 'string' || typeof link.target !== 'string') return false;
    const source = nodes.get(link.source), target = nodes.get(link.target);
    return source?.type === 'report' && target?.type === 'identifier' && link.kind === target.kind;
  }) && !!ring.stats && isCount(ring.stats.reports) && isCount(ring.stats.confirmed)
    && ring.stats.confirmed <= ring.stats.reports && isCount(ring.stats.maxHops);
}
export function isProof(value: unknown): value is ProofResponse {
  if (!isRecord(value) || typeof value.available !== 'boolean') return false;
  if (value.message !== undefined && typeof value.message !== 'string') return false;
  if (value.counts !== undefined && (!isRecord(value.counts) || !Object.values(value.counts).every(isCount))) return false;
  if (value.indexes !== undefined && (!Array.isArray(value.indexes) || !value.indexes.every(index => isRecord(index) && typeof index.collection === 'string' && typeof index.name === 'string' && isRecord(index.keys)))) return false;
  if (value.searchIndexes !== undefined && (!Array.isArray(value.searchIndexes) || !value.searchIndexes.every(index => isRecord(index) && typeof index.collection === 'string' && typeof index.name === 'string' && typeof index.status === 'string' && typeof index.queryable === 'boolean'))) return false;
  if (value.scan !== undefined && (!isRecord(value.scan) || typeof value.scan.stage !== 'string' || (value.scan.indexName !== null && typeof value.scan.indexName !== 'string') || !isCount(value.scan.keysExamined) || !isCount(value.scan.documentsExamined))) return false;
  if (value.ring !== undefined && (!isRecord(value.ring) || !['reports', 'sharedIdentifiers', 'confirmed', 'maxHops'].every(key => isCount((value.ring as Record<string, unknown>)[key])))) return false;
  return true;
}

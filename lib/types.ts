import type { ObjectId } from 'mongodb';

export type Source = 'facebook' | 'whatsapp' | 'telegram' | 'daft' | 'other';

export type ReportStatus = 'pending' | 'confirmed_scam' | 'legit' | 'rejected';

export type SignalCode =
  | 'ring_link'
  | 'photo_reuse'
  | 'text_clone'
  | 'script_match'
  | 'price_low';

export interface Signal {
  code: SignalCode;
  points: number;
  title: string;
  evidence: string;
  refs: string[];
}

export interface Verdict {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  signals: Signal[];
  summary: string;
  computedAt: Date;
}

export interface IdentifierHint {
  kind: 'phone' | 'email' | 'pay' | 'iban' | 'img';
  hint: string;
}

export interface Report {
  _id: ObjectId;
  source: Source;
  text: string;
  area: string;
  kind: 'room' | 'whole';
  bedrooms: number | null;
  priceEur: number | null;
  photoIds: ObjectId[];
  /** 'kind:value' where value is an HMAC-SHA256 hex, or 'img:<clusterId>'. Never raw. */
  identifiers: string[];
  identifierHints: IdentifierHint[];
  status: ReportStatus;
  seed: boolean;
  seedRing?: string;
  verdict?: Verdict;
  createdAt: Date;
  expiresAt?: Date;
}

export interface Photo {
  _id: ObjectId;
  reportId: ObjectId;
  clusterId: string;
  dhash: string;
  b0: string;
  b1: string;
  b2: string;
  b3: string;
  createdAt: Date;
}

export interface ScamPattern {
  _id: ObjectId;
  code: string;
  category:
    | 'absent_landlord'
    | 'mass_showing'
    | 'fake_agency'
    | 'advance_payment'
    | 'too_good'
    | 'identity_theft';
  title: string;
  text: string;
  advice: string;
  sourceUrl: string;
}

export interface RentBaseline {
  location: string;
  bedrooms: string;
  propertyType: string;
  quarter: string;
  avgRent: number;
}

export interface Check {
  _id: ObjectId;
  sessionId: string;
  reportId: ObjectId;
  createdAt: Date;
}

export interface Alert {
  _id: ObjectId;
  sessionId: string;
  reportId: ObjectId;
  triggerReportId: ObjectId;
  message: string;
  seen: boolean;
  createdAt: Date;
}

export interface ModerationEvent {
  _id: ObjectId;
  reportId: ObjectId;
  action: 'confirm' | 'reject' | 'legit';
  by: string;
  reason?: string;
  at: Date;
}

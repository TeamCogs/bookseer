export type MediaKind = 'ebook' | 'audiobook';
export type Source = 'bookorbit' | 'chaptarr';
export type Identifiers = { isbn: string[]; work: string[] };
export interface LibraryItem {
  id: string;
  source: Source;
  remoteId: string;
  title: string;
  author: string;
  mediaKind: MediaKind;
  formats: string[];
  available: boolean;
  identifiers: Identifiers;
  url?: string;
  coverUrl?: string;
  year?: number;
  originalTitle?: string;
}
export interface CatalogBook {
  id: string;
  title: string;
  author: string;
  year?: number;
  coverUrl?: string;
  identifiers: Identifiers;
  origin: 'openlibrary' | Source | 'demo';
}
export interface SourceState {
  source: Source;
  configured: boolean;
  status: 'unconfigured' | 'syncing' | 'healthy' | 'error';
  lastSuccess?: string;
  lastAttempt?: string;
  count: number;
  error?: string;
}
export type AvailabilityStatus = 'available' | 'needs_review' | 'not_found' | 'unknown';
export interface Availability {
  status: AvailabilityStatus;
  label: string;
  reason: string;
  items: LibraryItem[];
  candidates: LibraryItem[];
  stale: boolean;
  confirmed: boolean;
}
export interface BookResult {
  book: CatalogBook;
  availability: Record<MediaKind, Availability>;
  requests?: Partial<Record<MediaKind, { id: string; status: RequestStatus; following: boolean }>>;
  copies?: LibraryItem[];
}
export interface LibraryGroup {
  id: string;
  canonicalId: string;
  itemIds: string[];
}
export type RequestStatus =
  | 'pending_approval'
  | 'pending_setup'
  | 'pending_metadata'
  | 'checking'
  | 'submitting'
  | 'requested'
  | 'downloading'
  | 'importing'
  | 'available'
  | 'failed'
  | 'needs_review'
  | 'rejected'
  | 'cancelled';
export interface BookRequest {
  id: string;
  catalogId: string;
  mediaKind: MediaKind;
  title: string;
  author: string;
  coverUrl?: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  upstreamId?: number;
  message: string;
  requestedBy: string;
  requesterId: string;
  followers: number;
  following: boolean;
}
export interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  autoApprove: boolean;
  weeklyLimit: number;
  disabled: boolean;
  createdAt: string;
}
export interface Notification {
  id: number;
  message: string;
  requestId?: string;
  read: boolean;
  createdAt: string;
}
export interface AppStatus {
  version: string;
  demo: boolean;
  sources: SourceState[];
  libraryCount: number;
  requestCount: number;
  acquisitionReady: boolean;
  syncIntervalMinutes: number;
  inventoryMaxAgeHours: number;
}

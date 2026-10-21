import { resolve } from 'node:path';

export interface ConnectionConfig {
  bookorbitUrl: string;
  bookorbitPublicUrl: string;
  bookorbitUsername: string;
  bookorbitPassword: string;
  bookorbitLibraryIds: string;
  chaptarrUrl: string;
  chaptarrPublicUrl: string;
  chaptarrApiKey: string;
  ebookRootFolder: string;
  audiobookRootFolder: string;
  ebookQualityProfileId: number;
  ebookMetadataProfileId: number;
  audiobookQualityProfileId: number;
  audiobookMetadataProfileId: number;
}
export interface Config {
  port: number;
  host: string;
  dataDir: string;
  adminUsername: string;
  adminPassword: string;
  secret: string;
  publicUrl: string;
  secureCookies: boolean;
  demo: boolean;
  syncIntervalMinutes: number;
  inventoryMaxAgeHours: number;
  contact: string;
  connections: ConnectionConfig;
}
const integer = (value: string | undefined, fallback: number, min: number, max: number) => {
  if (!value) return fallback;
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`Expected an integer between ${min} and ${max}.`);
  return result;
};
export function validateServiceUrl(value: string): string {
  if (!value) return '';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Service URLs must use HTTP or HTTPS without credentials, query strings, or fragments.');
  }
  return url.toString().replace(/\/+$/, '');
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const demo = env.BOOKSEER_DEMO === 'true';
  const adminPassword = env.BOOKSEER_ADMIN_PASSWORD || '';
  const secret = env.BOOKSEER_SESSION_SECRET || '';
  if (!demo && (adminPassword.length < 12 || secret.length < 32)) {
    throw new Error('Set BOOKSEER_ADMIN_PASSWORD (at least 12 characters) and BOOKSEER_SESSION_SECRET (at least 32 characters). See .env.example.');
  }
  return {
    port: integer(env.PORT || env.BOOKSEER_PORT, 5057, 1, 65535),
    host: env.HOST || '127.0.0.1',
    dataDir: resolve(env.BOOKSEER_DATA_DIR || './data'),
    adminUsername: env.BOOKSEER_ADMIN_USERNAME || 'admin', adminPassword,
    secret, demo, publicUrl: validateServiceUrl(env.BOOKSEER_PUBLIC_URL || ''),
    secureCookies: env.BOOKSEER_SECURE_COOKIES === 'true',
    syncIntervalMinutes: integer(env.BOOKSEER_SYNC_INTERVAL_MINUTES, 30, 1, 1440),
    inventoryMaxAgeHours: integer(env.BOOKSEER_INVENTORY_MAX_AGE_HOURS, 24, 1, 720),
    contact: env.OPEN_LIBRARY_CONTACT || '',
    connections: {
      bookorbitUrl: validateServiceUrl(env.BOOKORBIT_URL || ''),
      bookorbitPublicUrl: validateServiceUrl(env.BOOKORBIT_PUBLIC_URL || env.BOOKORBIT_URL || ''),
      bookorbitUsername: env.BOOKORBIT_USERNAME || '', bookorbitPassword: env.BOOKORBIT_PASSWORD || '',
      bookorbitLibraryIds: env.BOOKORBIT_LIBRARY_IDS || '',
      chaptarrUrl: validateServiceUrl(env.CHAPTARR_URL || ''),
      chaptarrPublicUrl: validateServiceUrl(env.CHAPTARR_PUBLIC_URL || env.CHAPTARR_URL || ''),
      chaptarrApiKey: env.CHAPTARR_API_KEY || '',
      ebookRootFolder: env.CHAPTARR_EBOOK_ROOT_FOLDER || '',
      audiobookRootFolder: env.CHAPTARR_AUDIOBOOK_ROOT_FOLDER || '',
      ebookQualityProfileId: integer(env.CHAPTARR_EBOOK_QUALITY_PROFILE_ID, 0, 0, 1000000),
      ebookMetadataProfileId: integer(env.CHAPTARR_EBOOK_METADATA_PROFILE_ID, 0, 0, 1000000),
      audiobookQualityProfileId: integer(env.CHAPTARR_AUDIOBOOK_QUALITY_PROFILE_ID, 0, 0, 1000000),
      audiobookMetadataProfileId: integer(env.CHAPTARR_AUDIOBOOK_METADATA_PROFILE_ID, 0, 0, 1000000),
    },
  };
}

/**
 * Fingerprint Header Rotation — Randomize browser fingerprint headers to avoid detection.
 *
 * Qwen can detect static headers like bx-umidtoken, bx-ua, User-Agent.
 * This module generates randomized fingerprints for each request to reduce
 * detection risk.
 */

export interface BrowserFingerprint {
  userAgent: string;
  secChUa: string;
  secChUaMobile: string;
  secChUaPlatform: string;
  bxVersion: string;
}

const CHROME_VERSIONS = [
  { major: 125, build: '6422', patch: '77' },
  { major: 126, build: '6460', patch: '111' },
  { major: 127, build: '6514', patch: '89' },
  { major: 128, build: '6567', patch: '65' },
  { major: 129, build: '6621', patch: '41' },
  { major: 130, build: '6673', patch: '57' },
  { major: 131, build: '6728', patch: '33' },
  { major: 132, build: '6780', patch: '09' },
  { major: 133, build: '6832', patch: '85' },
  { major: 134, build: '6885', patch: '61' },
  { major: 135, build: '6938', patch: '37' },
  { major: 136, build: '6991', patch: '13' },
  { major: 148, build: '7166', patch: '97' },
];

const PLATFORMS = [
  { platform: 'Windows', uaPlatform: '"Windows"', osVersion: '10.0; Win64; x64' },
  { platform: 'macOS', uaPlatform: '"macOS"', osVersion: '10_15_7' },
  { platform: 'Linux', uaPlatform: '"Linux"', osVersion: 'x86_64' },
];

const BX_VERSIONS = ['2.5.36', '2.5.35', '2.5.34', '2.5.33', '2.5.32'];

/**
 * Generate a random hex string of given length.
 */
function randomHex(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Generate a random alphanumeric string.
 */
function randomAlphaNum(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Pick a random element from an array.
 */
function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a random bx-umidtoken-like string.
 * Format: T + base64-like encoded random data
 */
function generateBxUmidToken(): string {
  const prefix = 'T2g';
  const body = randomAlphaNum(120);
  const suffix = randomAlphaNum(10);
  return `${prefix}${body}${suffix}=`;
}

/**
 * Generate a random bx-ua-like string.
 * Format: Version! + base64-like encoded random data
 */
function generateBxUa(): string {
  const prefix = '231!';
  const segments = Array.from({ length: 8 }, () => randomAlphaNum(20 + Math.floor(Math.random() * 30)));
  return prefix + segments.join('+') + randomAlphaNum(20) + randomAlphaNum(40);
}

/**
 * Generate a new browser fingerprint.
 */
export function generateFingerprint(): BrowserFingerprint {
  const version = randomPick(CHROME_VERSIONS);
  const platform = randomPick(PLATFORMS);

  let userAgent: string;
  if (platform.platform === 'Windows') {
    userAgent = `Mozilla/5.0 (${platform.osVersion}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version.major}.0.${version.build}.${version.patch} Safari/537.36`;
  } else if (platform.platform === 'macOS') {
    userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X ${platform.osVersion}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version.major}.0.${version.build}.${version.patch} Safari/537.36`;
  } else {
    userAgent = `Mozilla/5.0 (X11; Linux ${platform.osVersion}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version.major}.0.${version.build}.${version.patch} Safari/537.36`;
  }

  const secChUa = `"Chromium";v="${version.major}", "Google Chrome";v="${version.major}", "Not/A)Brand";v="99"`;

  return {
    userAgent,
    secChUa,
    secChUaMobile: '?0',
    secChUaPlatform: platform.uaPlatform,
    bxVersion: randomPick(BX_VERSIONS),
  };
}

/**
 * Generate fingerprint headers for an HTTP request.
 * Returns a partial headers object that can be merged with other headers.
 */
export function generateFingerprintHeaders(): Record<string, string> {
  const fp = generateFingerprint();
  return {
    'User-Agent': fp.userAgent,
    'sec-ch-ua': fp.secChUa,
    'sec-ch-ua-mobile': fp.secChUaMobile,
    'sec-ch-ua-platform': fp.secChUaPlatform,
    'bx-v': fp.bxVersion,
    'bx-umidtoken': generateBxUmidToken(),
    'bx-ua': generateBxUa(),
  };
}

/**
 * Rotate fingerprint headers in an existing headers object.
 * Replaces fingerprint-related headers with fresh random ones.
 */
export function rotateHeaders(existingHeaders: Record<string, string>): Record<string, string> {
  const fresh = generateFingerprintHeaders();
  return {
    ...existingHeaders,
    ...fresh,
  };
}

// Counter for request-level rotation (rotate every N requests)
let requestCounter = 0;
let cachedFingerprint: Record<string, string> | null = null;
const ROTATE_EVERY_N = 5;

/**
 * Get fingerprint headers with periodic rotation.
 * Rotates every N requests to balance performance and stealth.
 */
export function getRotatingFingerprintHeaders(): Record<string, string> {
  requestCounter++;
  if (!cachedFingerprint || requestCounter % ROTATE_EVERY_N === 0) {
    cachedFingerprint = generateFingerprintHeaders();
  }
  return { ...cachedFingerprint };
}

/**
 * Force a fingerprint rotation on next request.
 */
export function forceRotate(): void {
  cachedFingerprint = null;
  requestCounter = 0;
}
import crypto from 'crypto';

// a-z, A-Z, 0-9 — 62자 풀 (62^8 ≈ 218조 조합)
const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PIN_LENGTH = 8;

function generatePin(): string {
  let pin = '';
  for (let i = 0; i < PIN_LENGTH; i++) {
    pin += CHARSET[crypto.randomInt(CHARSET.length)];
  }
  return pin;
}

// 서버 시작 시 1회 생성, 메모리에만 존재. 디스크에 저장하지 않음.
const SERVER_PIN = generatePin();

// 최근 인증 완료 정보 — provider가 토큰 발급 시 기록
interface AuthRecord {
  clientId: string;
  issuedAt: number; // epoch ms
}
let _lastAuth: AuthRecord | null = null;

export function getServerPin(): string {
  return SERVER_PIN;
}

export function markAuthorized(clientId: string): void {
  _lastAuth = { clientId, issuedAt: Date.now() };
}

export function getLastAuth(): AuthRecord | null {
  return _lastAuth;
}

/**
 * timing-safe 비교로 timing attack 방지.
 */
export function verifyPin(input: string): boolean {
  if (input.length !== SERVER_PIN.length) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(SERVER_PIN);
  return crypto.timingSafeEqual(a, b);
}

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

// 현재 활성 PIN — rotatePin() 호출 시 교체
let _currentPin: string = generatePin();

// 최근 인증 완료 정보 — provider가 토큰 발급 시 기록
interface AuthRecord {
  clientId: string;
  issuedAt: number; // epoch ms
}
let _lastAuth: AuthRecord | null = null;

/**
 * 서버 시작 시 터미널 배너용 PIN 반환.
 */
export function getServerPin(): string {
  return _currentPin;
}

/**
 * 새 PIN 생성 + lastAuth 초기화.
 * rcmcp auth 실행마다 호출 → 매번 새 PIN, 이전 인증 기록 클리어.
 */
export function rotatePin(): string {
  _currentPin = generatePin();
  _lastAuth = null;
  return _currentPin;
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
  if (input.length !== _currentPin.length) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(_currentPin);
  return crypto.timingSafeEqual(a, b);
}

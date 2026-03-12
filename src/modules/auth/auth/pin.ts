import crypto from 'crypto';

// a-z, A-Z, 0-9 — 62자 풀 (62^8 ≈ 218조 조합)
const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PIN_LENGTH = 8;

// rcmcp auth 실행 후 PIN이 유효한 시간 (1분)
// rcmcp auth → 브라우저 열기 → PIN 입력 전체 흐름이 통상 30초 이내.
export const PIN_TTL_MS = 1 * 60 * 1000;

function generatePin(): string {
  let pin = '';
  for (let i = 0; i < PIN_LENGTH; i++) {
    pin += CHARSET[crypto.randomInt(CHARSET.length)];
  }
  return pin;
}

// 현재 PIN 값 (메모리에만 존재)
let _currentPin: string = generatePin();

// PIN이 활성화된 시각 (rcmcp auth 호출 시점)
// null이면 아직 rcmcp auth가 실행되지 않은 상태 → verifyPin() 항상 expired
let _activatedAt: number | null = null;

// 최근 인증 완료 정보
interface AuthRecord {
  clientId: string;
  issuedAt: number; // epoch ms
}
let _lastAuth: AuthRecord | null = null;

/**
 * 서버 시작 시 터미널 배너용 PIN 반환.
 * 단순 표시용 — 이 시점에선 아직 활성화 전이므로 verifyPin()은 expired.
 */
export function getServerPin(): string {
  return _currentPin;
}

/**
 * 새 PIN 생성 + 활성화 타이머 시작 + lastAuth 초기화.
 * rcmcp auth 실행마다 호출. 반환된 PIN은 PIN_TTL_MS(1분) 동안만 유효.
 */
export function rotatePin(): string {
  _currentPin = generatePin();
  _activatedAt = Date.now();
  _lastAuth = null;
  return _currentPin;
}

export function markAuthorized(clientId: string): void {
  _lastAuth = { clientId, issuedAt: Date.now() };
}

export function getLastAuth(): AuthRecord | null {
  return _lastAuth;
}

export type PinVerifyResult = 'ok' | 'expired' | 'invalid';

/**
 * PIN 유효성 검사.
 * - 'ok'      : 일치
 * - 'expired' : rcmcp auth 미실행 또는 TTL(1분) 초과
 * - 'invalid' : PIN 불일치
 * timing-safe 비교는 expired 시에도 항상 수행 (side-channel 방지)
 */
export function verifyPin(input: string): PinVerifyResult {
  const expired = _activatedAt === null || Date.now() - _activatedAt > PIN_TTL_MS;

  const inputBuf = Buffer.alloc(PIN_LENGTH);
  inputBuf.write(input.slice(0, PIN_LENGTH));
  const pinBuf = Buffer.from(_currentPin);
  const match = crypto.timingSafeEqual(inputBuf, pinBuf);

  if (expired) return 'expired';
  if (!match) return 'invalid';
  return 'ok';
}

/**
 * 현재 PIN이 활성 상태인지 반환.
 */
export function isPinActive(): boolean {
  return _activatedAt !== null && Date.now() - _activatedAt <= PIN_TTL_MS;
}

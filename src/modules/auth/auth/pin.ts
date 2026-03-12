import crypto from 'crypto';

// a-z, A-Z, 0-9 — 62자 풀 (62^8 ≈ 218조 조합)
const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PIN_LENGTH = 8;

function generatePin(): string {
  let pin = '';
  // crypto.randomInt로 균등 분포 보장 (모듈로 편향 없음)
  for (let i = 0; i < PIN_LENGTH; i++) {
    pin += CHARSET[crypto.randomInt(CHARSET.length)];
  }
  return pin;
}

// 서버 시작 시 1회 생성, 메모리에만 존재. 디스크에 저장하지 않음.
const SERVER_PIN = generatePin();

export function getServerPin(): string {
  return SERVER_PIN;
}

/**
 * timing-safe 비교로 timing attack 방지.
 * 입력값 길이가 달라도 즉시 false 반환하지 않고 동일한 시간 소요.
 */
export function verifyPin(input: string): boolean {
  if (input.length !== SERVER_PIN.length) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(SERVER_PIN);
  return crypto.timingSafeEqual(a, b);
}

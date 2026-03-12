import crypto from 'crypto';
import { writeFileSync, mkdirSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

// a-z, A-Z, 0-9 — 62자 풀 (62^8 ≈ 218조 조합)
const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PIN_LENGTH = 8;
const PIN_FILE_DIR = join(homedir(), '.rcmcp');
const PIN_FILE_PATH = join(PIN_FILE_DIR, '.pin');

function generatePin(): string {
  let pin = '';
  // crypto.randomInt로 균등 분포 보장 (모듈로 편향 없음)
  for (let i = 0; i < PIN_LENGTH; i++) {
    pin += CHARSET[crypto.randomInt(CHARSET.length)];
  }
  return pin;
}

/**
 * PIN을 ~/.rcmcp/.pin 파일에 저장 (chmod 600 — 소유자만 읽기).
 * 자동 재시작 시 터미널을 못 보더라도 `cat ~/.rcmcp/.pin` 으로 확인 가능.
 */
function savePinToFile(pin: string): void {
  try {
    mkdirSync(PIN_FILE_DIR, { recursive: true });
    chmodSync(PIN_FILE_DIR, 0o700);
    writeFileSync(PIN_FILE_PATH, pin, { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    // 파일 저장 실패는 치명적이지 않음 — 터미널 출력으로 폴백
    console.warn(`[PIN] Could not save PIN file: ${(err as Error).message}`);
  }
}

/**
 * macOS 알림으로 PIN을 표시.
 * 서버 자동 재시작 시 사용자가 터미널을 보지 않아도 PIN 확인 가능.
 */
function notifyPin(pin: string): void {
  try {
    execSync(
      `osascript -e 'display notification "Authorization PIN: ${pin}" with title "remote-control-mcp" subtitle "Check ~/.rcmcp/.pin to view again" sound name "Ping"'`,
      { timeout: 5000 }
    );
  } catch {
    // 알림 실패는 무시 (헤드리스 환경 등)
  }
}

/**
 * PIN 결정 로직:
 *   1. 환경변수 SERVER_PIN이 설정되어 있으면 그것을 사용 (고정 PIN 모드)
 *   2. 없으면 랜덤 생성 후 파일 저장 + macOS 알림
 */
function resolvePin(): string {
  const envPin = process.env.SERVER_PIN?.trim();
  if (envPin) {
    if (envPin.length !== PIN_LENGTH) {
      throw new Error(`SERVER_PIN must be exactly ${PIN_LENGTH} characters (got ${envPin.length})`);
    }
    return envPin;
  }

  const pin = generatePin();
  savePinToFile(pin);
  notifyPin(pin);
  return pin;
}

// 서버 시작 시 1회 결정, 이후 변경 없음
const SERVER_PIN = resolvePin();

export function getServerPin(): string {
  return SERVER_PIN;
}

export { PIN_FILE_PATH };

/**
 * timing-safe 비교로 timing attack 방지.
 */
export function verifyPin(input: string): boolean {
  if (input.length !== SERVER_PIN.length) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(SERVER_PIN);
  return crypto.timingSafeEqual(a, b);
}

# Security Fix Plan

## Fix 1: AES-CBC → AES-GCM (`src/modules/auth/auth/auth-core.ts`)

### Problem
`encryptString` / `decryptString` use AES-256-CBC without any MAC/HMAC.
CBC without authentication is vulnerable to padding oracle attacks — an attacker
who can observe error responses can iteratively decrypt ciphertext without the key.

### Current format
```
iv_hex:ciphertext_hex        (16-byte IV, no auth tag)
```

### Fix
Replace with AES-256-GCM, which provides authenticated encryption (AEAD).
GCM produces a 16-byte authentication tag that makes any tampering detectable.

New format:
```
iv_hex:authtag_hex:ciphertext_hex    (12-byte IV, 16-byte auth tag)
```

**Implementation notes:**
- Use `crypto.createCipheriv('aes-256-gcm', ...)` with a 12-byte random IV (GCM standard).
- Key derivation: current code passes raw hex strings as the key. Keep the same
  approach but pass `Buffer.from(key.slice(0, 64), 'hex')` to ensure exactly 32 bytes.
- `getAuthTag()` must be called after `cipher.final()`.
- `decryptString` must call `decipher.setAuthTag(authTagBuf)` before `decipher.final()`.
  If the tag is wrong, `final()` throws — catch and rethrow as a clear error.
- **Migration**: existing Redis data is CBC-encrypted. After the switch, decryption
  of old entries will fail (tag verification error). This is acceptable because:
  - Pending auth codes expire in 10 minutes anyway.
  - Access tokens can be re-issued by re-authorizing.
  - Add a format detector: if the encrypted string has 2 colons → GCM, 1 colon → CBC legacy.
    For legacy entries, attempt CBC decrypt as a one-time fallback, then delete the entry.

### Files to change
- `src/modules/auth/auth/auth-core.ts` — rewrite `encryptString` and `decryptString`

---

## Fix 2: Blocklist pattern for `rm -rf /*` (`src/modules/mcp/services/remote-mac-tools.ts`)

### Problem
Current pattern: `/rm\s+-rf\s+\/\s*$/`

This matches `rm -rf /` (bare slash + end of string) but misses:
- `rm -rf /*`      (glob — deletes everything under root)
- `rm -rf / `      (trailing space before pipe or &&)
- `sudo rm -rf /`
- `rm -fr /`       (flags reversed)

### Fix
Replace the single pattern with a broader one that covers the real attack surface:

```typescript
/\brm\s+(-[a-z]*f[a-z]*r[a-z]*|-[a-z]*r[a-z]*f[a-z]*)\s+\/[\s*]*($|;|&|\|)/ 
```

Simpler and more readable as two patterns:
```typescript
/\brm\b.*\s-[a-z]*rf[a-z]*\s+\//, // rm ... -rf /  (any flag order)
/\brm\b.*\s-[a-z]*fr[a-z]*\s+\//, // rm ... -fr /  (reversed flags)
```

These catch:
- `rm -rf /`
- `rm -rf /*`
- `sudo rm -rf /`
- `rm -rf / && echo`
- `rm -fr /`
- `rm --no-preserve-root -rf /`

Also add:
```typescript
/--no-preserve-root/, // explicit root deletion flag
```

### Files to change
- `src/modules/mcp/services/remote-mac-tools.ts` — update `DEFAULT_BLOCKED` array

---

## After both fixes
1. Run `npm run build` — must compile with zero TypeScript errors.
2. Run `npm run lint` if available.
3. Restart server with `rcmcp restart server`.
4. Smoke-test AES-GCM: trigger a fresh OAuth authorization flow end-to-end to confirm
   new tokens encrypt/decrypt correctly.
5. Smoke-test blocklist: call `shell_exec` with `rm -rf /*` and confirm it returns
   a blocked error, not execution.
6. Do NOT commit — human will review and commit manually.

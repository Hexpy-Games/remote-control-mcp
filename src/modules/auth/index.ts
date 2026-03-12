/**
 * Auth Module - Self-contained authentication module
 *
 * This module encapsulates all OAuth/authentication functionality.
 * In internal mode, it runs in-process but maintains architectural separation.
 * It acts as a stand-in for an external OAuth server (Auth0, Okta, etc).
 *
 * IMPORTANT: This is NOT using the deprecated MCP SDK integrated auth pattern.
 * Even in internal mode, the auth module is architecturally separate from MCP.
 */

import { Router } from 'express';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { FeatureReferenceAuthProvider } from './auth/provider.js';
import { verifyPin, markAuthorized, rotatePin } from './auth/pin.js';
import { readPendingAuthorization } from './services/auth.js';
import { TokenIntrospectionResponse } from '../../interfaces/auth-validator.js';
import { logger } from '../shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AuthConfig {
  baseUri: string;
  authServerUrl?: string; // For metadata purposes
  redisUrl?: string;
}

export class AuthModule {
  private provider: FeatureReferenceAuthProvider;
  private router: Router;

  constructor(private config: AuthConfig) {
    this.provider = new FeatureReferenceAuthProvider();
    this.router = this.setupRouter();
  }

  /**
   * Get Express router with all auth endpoints
   */
  getRouter(): Router {
    return this.router;
  }

  /**
   * Direct token introspection for internal mode
   * Returns the same format as the /introspect endpoint would
   */
  async introspectToken(token: string): Promise<TokenIntrospectionResponse> {
    try {
      const authInfo = await this.provider.verifyAccessToken(token);

      // Return RFC 7662 compliant introspection response
      return {
        active: true,
        client_id: authInfo.clientId,
        scope: authInfo.scopes.join(' '),
        exp: authInfo.expiresAt,
        sub: String(authInfo.extra?.userId || 'unknown'),
        username: authInfo.extra?.username as string | undefined,
        aud: this.config.baseUri,
        iss: this.config.authServerUrl || this.config.baseUri,
        token_type: 'Bearer'
      };
    } catch (error) {
      logger.debug('Token introspection failed', { error: (error as Error).message });
      return { active: false };
    }
  }

  private setupRouter(): Router {
    const router = Router();

    // Rate limiters
    const staticAssetLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 100,
      message: 'Too many requests for static assets',
      standardHeaders: true,
      legacyHeaders: false,
    });

    // PIN confirm: 5 attempts per 10 minutes per IP (brute force 방지)
    const pinConfirmLimiter = rateLimit({
      windowMs: 10 * 60 * 1000,
      max: 5,
      message: 'Too many PIN attempts. Try again later.',
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: true, // 성공한 요청은 카운트 제외
    });

    // OAuth endpoints via SDK's mcpAuthRouter
    router.use(mcpAuthRouter({
      provider: this.provider,
      issuerUrl: new URL(this.config.authServerUrl || this.config.baseUri),
      tokenOptions: {
        rateLimit: { windowMs: 5000, limit: 100 }
      },
      clientRegistrationOptions: {
        rateLimit: { windowMs: 60000, limit: 10 }
      }
    }));

    /**
     * POST /authorize/confirm
     * PIN 검증 후 client의 redirectUri로 auth code를 전달.
     * PIN이 틀리면 403 반환 (rate limiter가 5회 실패 시 잠금).
     */
    router.post('/authorize/confirm',
      pinConfirmLimiter,
      express.urlencoded({ extended: false }),
      async (req, res) => {
        const { code, pin } = req.body as { code?: string; pin?: string };

        // 입력값 기본 검증
        if (!code || !pin) {
          res.status(400).send('Bad request: missing code or pin');
          return;
        }

        // PIN 검증 (timing-safe)
        if (!verifyPin(pin)) {
          logger.warning('PIN verification failed', { ip: req.ip });
          res.status(403).send('Invalid PIN.');
          return;
        }

        // pending auth 조회
        const pending = await readPendingAuthorization(code);
        if (!pending) {
          res.status(400).send('Authorization code expired or not found.');
          return;
        }

        // 검증 통과 → client redirectUri로 code + state 전달
        const redirectUrl = new URL(pending.redirectUri);
        redirectUrl.searchParams.set('code', code);
        if (pending.state) redirectUrl.searchParams.set('state', pending.state);

        // 1회용 PIN: 인증 성공 즉시 rotate → 같은 PIN으로 재사용 불가
        // ⚠️ rotatePin()은 _lastAuth를 null로 초기화하므로 markAuthorized 앞에 호출해야 함
        rotatePin();

        // PIN rotate 후 폴링 감지용 기록 (rotate가 _lastAuth를 저령하며 이미 null이므로 여기서 덮어씨)
        markAuthorized(pending.clientId);

        logger.debug('PIN verified, redirecting to client', {
          code: code.substring(0, 8) + '...',
          clientId: pending.clientId,
          redirectUrl: redirectUrl.toString(),
          hasState: !!pending.state,
        });

        // form-action CSP 우회: res.redirect()는 302 redirect chain을 form-action으로 검사하는 브라우저에서 차단됨.
        // meta refresh는 navigation이므로 form-action CSP에 해당 없음.
        res.setHeader('Content-Security-Policy', [
          "default-src 'none'",
          "style-src 'unsafe-inline'",
        ].join('; '));
        res.send(`<!DOCTYPE html><html><head>
          <meta http-equiv="refresh" content="0;url=${redirectUrl.toString()}">
          <style>body{font-family:system-ui;background:#0a0a0a;color:#f0f0f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;font-size:15px;}</style>
        </head><body>Redirecting…</body></html>`);
        return;
      }
    );

    // Token introspection endpoint (RFC 7662)
    router.post('/introspect', express.urlencoded({ extended: false }), async (req, res) => {
      try {
        const { token } = req.body;

        if (!token) {
          return res.status(400).json({
            error: 'invalid_request',
            error_description: 'Missing token parameter'
          });
        }

        const result = await this.introspectToken(token);
        res.json(result);

      } catch (error) {
        logger.error('Introspection endpoint error', error as Error);
        res.json({ active: false });
      }
    });

    // Static assets for auth pages
    router.get('/mcp-logo.png', staticAssetLimiter, (_req, res) => {
      const logoPath = path.join(__dirname, 'static', 'mcp.png');
      res.sendFile(logoPath);
    });

    return router;
  }
}

/**
 * Token validation interface — the only connection between Auth and MCP modules.
 *
 * Abstracts token validation so the MCP module doesn't depend on auth internals.
 * Mimics the OAuth 2.0 Token Introspection endpoint (RFC 7662).
 */

import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthModule } from '../modules/auth/index.js';

/**
 * Token introspection response per RFC 7662
 * https://datatracker.ietf.org/doc/html/rfc7662
 */
export interface TokenIntrospectionResponse {
  active: boolean;
  client_id?: string;
  scope?: string;
  exp?: number;
  sub?: string;
  aud?: string | string[];
  username?: string;
  token_type?: string;
  iss?: string;
  nbf?: number;
  iat?: number;
}

export interface ITokenValidator {
  introspect(token: string): Promise<TokenIntrospectionResponse>;
  verifyAccessToken(token: string): Promise<AuthInfo>;
}

abstract class BaseTokenValidator implements ITokenValidator {
  abstract introspect(token: string): Promise<TokenIntrospectionResponse>;

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const result = await this.introspect(token);

    if (!result.active) {
      throw new InvalidTokenError('Token is not active');
    }

    if (result.exp && result.exp < Date.now() / 1000) {
      throw new InvalidTokenError('Token has expired');
    }

    return {
      token,
      clientId: result.client_id || 'unknown',
      scopes: result.scope?.split(' ') || [],
      expiresAt: result.exp,
      extra: {
        userId: result.sub || 'unknown',
        audience: result.aud,
        username: result.username,
        issuer: result.iss
      }
    };
  }
}

/**
 * Validates tokens via direct method call into the in-process auth module.
 * Even though auth runs in the same process, we still go through this
 * interface to keep architectural separation intact.
 */
export class InternalTokenValidator extends BaseTokenValidator {
  constructor(private authModule: AuthModule) {
    super();
  }

  async introspect(token: string): Promise<TokenIntrospectionResponse> {
    return this.authModule.introspectToken(token);
  }
}

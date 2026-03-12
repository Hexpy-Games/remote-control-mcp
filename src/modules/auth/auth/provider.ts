import { Response } from 'express';
import { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  generateToken,
  getClientRegistration,
  readPendingAuthorization,
  readMcpInstallation,
  revokeMcpInstallation,
  saveClientRegistration,
  savePendingAuthorization,
  readRefreshToken,
  generateMcpTokens,
  saveMcpInstallation,
  saveRefreshToken,
  saveTokenExchange,
} from '../services/auth.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { logger } from '../../shared/logger.js';

export class FeatureReferenceOAuthClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const registration = await getClientRegistration(clientId);
    return registration ?? undefined;
  }

  async registerClient(client: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    await saveClientRegistration(client.client_id, client);
    return client;
  }
}

export class FeatureReferenceAuthProvider implements OAuthServerProvider {
  private _clientsStore: FeatureReferenceOAuthClientsStore;

  constructor() {
    this._clientsStore = new FeatureReferenceOAuthClientsStore();
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  /**
   * Renders a PIN-gated authorization page.
   * The server prints a one-time PIN (a-z A-Z 0-9, 8 chars) to its terminal on startup.
   * Without the PIN the Approve button is unreachable, even if the tunnel URL is known.
   *
   * Flow:
   *   GET /authorize  →  render PIN form  (this method)
   *   POST /authorize/confirm  →  verify PIN, redirect to client redirectUri with code
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const authorizationCode = generateToken();

    await savePendingAuthorization(authorizationCode, {
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: 'S256',
      clientId: client.client_id,
      state: params.state,
    });

    logger.debug('Saved pending authorization', {
      code: authorizationCode.substring(0, 8) + '...',
      clientId: client.client_id,
    });

    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'none'",
      "img-src 'self' data:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; '));

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Remote Mac MCP — Authorization</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #f0f0f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #161616;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 40px;
      max-width: 480px;
      width: 100%;
    }
    .warn-banner {
      background: #3d1f00;
      border: 1px solid #f59e0b;
      color: #fde68a;
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 13px;
      line-height: 1.5;
      margin-bottom: 28px;
    }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
    .sub { color: #888; font-size: 14px; margin-bottom: 28px; }
    .client-id { background: #0f0f0f; border: 1px solid #2a2a2a; border-radius: 6px; padding: 10px 14px; font-size: 13px; font-family: monospace; color: #aaa; word-break: break-all; margin-bottom: 28px; }
    .pin-label { font-size: 13px; color: #888; margin-bottom: 8px; }
    .pin-input {
      width: 100%;
      background: #0f0f0f;
      border: 1px solid #3a3a3a;
      border-radius: 6px;
      padding: 12px 14px;
      font-size: 18px;
      font-family: monospace;
      letter-spacing: 0.15em;
      color: #f0f0f0;
      margin-bottom: 8px;
      outline: none;
    }
    .pin-input:focus { border-color: #16a34a; }
    .pin-hint { font-size: 11px; color: #555; margin-bottom: 24px; }
    .error-msg { color: #ef4444; font-size: 13px; margin-bottom: 16px; display: none; }
    .actions { display: flex; gap: 12px; }
    .btn { flex: 1; padding: 12px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; text-align: center; border: none; }
    .btn-approve { background: #16a34a; color: #fff; }
    .btn-approve:hover { background: #15803d; }
    .btn-deny { background: #1e1e1e; color: #888; border: 1px solid #333; text-decoration: none; display: inline-block; }
    .btn-deny:hover { background: #2a2a2a; }
    .footer { margin-top: 24px; color: #555; font-size: 11px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="warn-banner">
      ⚠️ <strong>This grants full shell access to your Mac.</strong><br>
      Only approve if you initiated this connection from a trusted client.
    </div>
    <h1>Authorization Request</h1>
    <p class="sub">A client is requesting access to this MCP server.</p>
    <div class="client-id">${client.client_id}</div>

    <form method="POST" action="/authorize/confirm">
      <input type="hidden" name="code" value="${authorizationCode}" />
      <p class="pin-label">Server PIN</p>
      <input
        class="pin-input"
        type="password"
        name="pin"
        maxlength="8"
        autocomplete="off"
        autofocus
        placeholder="••••••••"
      />
      <p class="pin-hint">Check the terminal where the MCP server is running.</p>
      <div class="actions">
        <button type="submit" class="btn btn-approve">✓ Approve</button>
        <a href="/" class="btn btn-deny">✗ Deny</a>
      </div>
    </form>

    <div class="footer">Remote Mac MCP Server</div>
  </div>
</body>
</html>`);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const pendingAuth = await readPendingAuthorization(authorizationCode);
    if (!pendingAuth) throw new Error('Authorization code not found');
    if (pendingAuth.clientId !== client.client_id)
      throw new Error('Authorization code does not match client');
    return pendingAuth.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<OAuthTokens> {
    const pendingAuth = await readPendingAuthorization(authorizationCode);
    if (!pendingAuth) throw new Error('Invalid authorization code');
    if (pendingAuth.clientId !== client.client_id)
      throw new Error('Authorization code does not match client');

    const mcpTokens = generateMcpTokens();

    await saveMcpInstallation(mcpTokens.access_token, {
      mcpTokens,
      clientId: client.client_id,
      issuedAt: Date.now() / 1000,
      userId: client.client_id,
    });

    if (mcpTokens.refresh_token) {
      await saveRefreshToken(mcpTokens.refresh_token, mcpTokens.access_token);
    }

    await saveTokenExchange(authorizationCode, {
      mcpAccessToken: mcpTokens.access_token,
      alreadyUsed: false,
    });

    logger.debug('Authorization code exchanged', { clientId: client.client_id });

    return {
      access_token: mcpTokens.access_token,
      refresh_token: mcpTokens.refresh_token,
      expires_in: mcpTokens.expires_in,
      token_type: 'Bearer',
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[]
  ): Promise<OAuthTokens> {
    const oldAccessToken = await readRefreshToken(refreshToken);
    if (!oldAccessToken) throw new Error('Invalid refresh token');

    const mcpInstallation = await readMcpInstallation(oldAccessToken);
    if (!mcpInstallation) throw new Error('Invalid refresh token');
    if (mcpInstallation.clientId !== client.client_id) throw new Error('Invalid client');

    const newTokens = generateMcpTokens();

    await revokeMcpInstallation(oldAccessToken);

    if (newTokens.refresh_token) {
      await saveRefreshToken(newTokens.refresh_token, newTokens.access_token);
    }
    await saveMcpInstallation(newTokens.access_token, {
      ...mcpInstallation,
      mcpTokens: newTokens,
      issuedAt: Date.now() / 1000,
    });

    logger.debug('Refresh token rotated', { clientId: client.client_id });
    return newTokens;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const installation = await readMcpInstallation(token);
    if (!installation) throw new InvalidTokenError('Invalid access token');

    const expiresAt = installation.mcpTokens.expires_in
      ? installation.mcpTokens.expires_in + installation.issuedAt
      : undefined;

    if (expiresAt && expiresAt < Date.now() / 1000) {
      throw new InvalidTokenError('Token has expired');
    }

    return {
      token,
      clientId: installation.clientId,
      scopes: ['mcp', 'claudeai'],
      expiresAt,
      extra: { userId: installation.userId },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    await revokeMcpInstallation(request.token);
  }
}

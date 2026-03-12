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
import { markAuthorized } from './pin.js';
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
      "script-src 'unsafe-inline'",
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
    .pin-label { font-size: 13px; color: #888; margin-bottom: 12px; }
    .pin-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .pin-group {
      display: flex;
      gap: 6px;
    }
    .pin-cell {
      width: 44px;
      height: 52px;
      background: #0f0f0f;
      border: 1px solid #3a3a3a;
      border-radius: 6px;
      font-size: 22px;
      font-family: monospace;
      font-weight: 600;
      color: #f0f0f0;
      text-align: center;
      outline: none;
      caret-color: #16a34a;
      transition: border-color 0.15s;
    }
    .pin-cell:focus { border-color: #16a34a; box-shadow: 0 0 0 2px rgba(22,163,74,0.2); }
    .pin-cell.filled { border-color: #2a6a3a; }
    .pin-sep { font-size: 22px; color: #555; font-weight: 300; user-select: none; }
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

    <form method="POST" action="/authorize/confirm" id="pinForm">
      <input type="hidden" name="code" value="${authorizationCode}" />
      <input type="hidden" name="pin" id="pinHidden" />
      <p class="pin-label">Server PIN</p>
      <div class="pin-row">
        <div class="pin-group" id="group1">
          <input class="pin-cell" type="text" inputmode="text" maxlength="1" autocomplete="off" spellcheck="false" data-idx="0">
          <input class="pin-cell" type="text" inputmode="text" maxlength="1" autocomplete="off" spellcheck="false" data-idx="1">
          <input class="pin-cell" type="text" inputmode="text" maxlength="1" autocomplete="off" spellcheck="false" data-idx="2">
          <input class="pin-cell" type="text" inputmode="text" maxlength="1" autocomplete="off" spellcheck="false" data-idx="3">
        </div>
        <span class="pin-sep">&ndash;</span>
        <div class="pin-group" id="group2">
          <input class="pin-cell" type="text" inputmode="text" maxlength="1" autocomplete="off" spellcheck="false" data-idx="4">
          <input class="pin-cell" type="text" inputmode="text" maxlength="1" autocomplete="off" spellcheck="false" data-idx="5">
          <input class="pin-cell" type="text" inputmode="text" maxlength="1" autocomplete="off" spellcheck="false" data-idx="6">
          <input class="pin-cell" type="text" inputmode="text" maxlength="1" autocomplete="off" spellcheck="false" data-idx="7">
        </div>
      </div>
      <p class="pin-hint">
        Run <code style="background:#1a1a1a;padding:1px 5px;border-radius:3px;font-size:11px">rcmcp auth</code> on the Mac to get the PIN.
        &nbsp;<a href="https://github.com/Hexpy-Games/remote-control-mcp#authorization" target="_blank" style="color:#555;font-size:11px">Help &nearr;</a>
      </p>
      <div class="actions">
        <button type="submit" class="btn btn-approve" id="approveBtn" disabled>✓ Approve</button>
        <a href="/" class="btn btn-deny">✗ Deny</a>
      </div>
    </form>
    <script>
      (function() {
        var cells = Array.from(document.querySelectorAll('.pin-cell'));
        var hidden = document.getElementById('pinHidden');
        var btn = document.getElementById('approveBtn');

        cells[0].focus();

        function updateHidden() {
          var val = cells.map(function(c){ return c.value; }).join('');
          hidden.value = val;
          btn.disabled = val.length < 8;
        }

        cells.forEach(function(cell, i) {
          cell.addEventListener('input', function() {
            // 붙여넣기 처리: 8자 혹은 9자(대시 포함) 한번에
            var raw = cell.value.replace(/-/g,'');
            if (raw.length > 1) {
              var chars = raw.slice(0, 8).split('');
              chars.forEach(function(ch, j) {
                if (cells[j]) { cells[j].value = ch; cells[j].classList.toggle('filled', !!ch); }
              });
              var last = Math.min(chars.length, 7);
              cells[last] && cells[last].focus();
              updateHidden();
              return;
            }
            cell.classList.toggle('filled', !!cell.value);
            if (cell.value && i < 7) cells[i+1].focus();
            updateHidden();
          });

          cell.addEventListener('keydown', function(e) {
            if (e.key === 'Backspace' && !cell.value && i > 0) {
              cells[i-1].value = '';
              cells[i-1].classList.remove('filled');
              cells[i-1].focus();
              updateHidden();
            }
          });

          cell.addEventListener('paste', function(e) {
            e.preventDefault();
            var text = (e.clipboardData || window.clipboardData).getData('text').replace(/-/g,'').slice(0,8);
            text.split('').forEach(function(ch, j) {
              if (cells[j]) { cells[j].value = ch; cells[j].classList.toggle('filled', true); }
            });
            var nextIdx = Math.min(text.length, 7);
            cells[nextIdx].focus();
            updateHidden();
          });
        });

        document.getElementById('pinForm').addEventListener('submit', function() {
          updateHidden();
        });
      })();
    </script>

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

    markAuthorized(client.client_id);
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

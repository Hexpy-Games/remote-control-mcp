/**
 * Remote Mac MCP Server — Entry Point
 *
 * Single-process server: OAuth auth + MCP endpoint in one process.
 * Exposes shell_exec, osascript, file_read, file_write tools to MCP clients (Claude, Cursor, etc.).
 */

import { resolve, basename, extname } from 'path';
import { existsSync as fileExists, statSync as fileStat, createReadStream } from 'fs';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { AuthModule } from './modules/auth/index.js';
import { MCPModule } from './modules/mcp/index.js';
import { InternalTokenValidator } from './interfaces/auth-validator.js';
import { redisClient } from './modules/shared/redis.js';
import { logger } from './modules/shared/logger.js';
import { getServerPin } from './modules/auth/auth/pin.js';

const ADMIN_PORT = 3233;

async function main() {
  console.log('');
  console.log('========================================');
  console.log('Remote Mac MCP Server');
  console.log('========================================');

  // ── Authorization PIN ──
  // 메모리에만 존재. 디스크에 저장하지 않음.
  // 터미널 출력 외에 `rcmcp auth` 명령어로 언제든 확인 가능 (localhost 전용 admin 포트).
  const pin = getServerPin();
  console.log('');
  console.log('┌──────────────────────────────────────┐');
  console.log(`│  Authorization PIN: ${pin}        │`);
  console.log('│  Required to approve MCP access      │');
  console.log(`│  Run 'rcmcp auth' to view again       │`);
  console.log('└──────────────────────────────────────┘');
  console.log('');

  const app = express();
  app.set('trust proxy', 'loopback');

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(logger.middleware());

  app.get('/ping', (_req, res) => {
    res.json({ pong: true, time: Date.now() });
  });

  // Connect to Redis if configured.
  // If REDIS_URL is set but connection fails, always exit — silent failure
  // would cause tokens to be stored in-memory while the app appears healthy.
  if (config.redis.enabled && config.redis.url) {
    try {
      await redisClient.connect();
      console.log('✓ Redis connected:', config.redis.url);
    } catch (error) {
      logger.error('Failed to connect to Redis', error as Error);
      console.error('');
      console.error('  ✗ Could not connect to Redis at: ' + config.redis.url);
      console.error('    Tokens cannot be persisted — refusing to start.');
      console.error('    Fix: check REDIS_URL in .env, or remove it to run without Redis.');
      console.error('');
      process.exit(1);
    }
  } else {
    console.log('⚠  Redis not configured — using in-memory store (tokens reset on restart)');
  }

  // OAuth metadata discovery endpoint
  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    logger.info('OAuth metadata discovery', {
      userAgent: req.get('user-agent'),
      ip: req.ip
    });
    res.json({
      issuer: config.baseUri,
      authorization_endpoint: `${config.baseUri}/authorize`,
      token_endpoint: `${config.baseUri}/token`,
      registration_endpoint: `${config.baseUri}/register`,
      introspection_endpoint: `${config.baseUri}/introspect`,
      revocation_endpoint: `${config.baseUri}/revoke`,
      token_endpoint_auth_methods_supported: ['none'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['mcp', 'claudeai'],
      service_documentation: 'https://modelcontextprotocol.io'
    });
  });

  // Auth module
  const authModule = new AuthModule({
    baseUri: config.baseUri,
    authServerUrl: config.baseUri,
    redisUrl: config.redis.url
  });

  // ── Static file serving from ~/Public/mcp-files/ ──
  const MCP_FILES_DIR = resolve(process.env.HOME || '/tmp', 'Public/mcp-files');
  const MIME_TYPES: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4', '.pdf': 'application/pdf',
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.txt': 'text/plain',
  };
  app.get('/files/:filename', (req, res) => {
    const filename = basename(req.params.filename);
    const filePath = resolve(MCP_FILES_DIR, filename);
    if (!filePath.startsWith(MCP_FILES_DIR)) { res.status(403).send('Forbidden'); return; }
    if (!fileExists(filePath)) { res.status(404).send('Not found'); return; }
    try {
      const stat = fileStat(filePath);
      if (!stat.isFile()) { res.status(404).send('Not found'); return; }
      const ext = extname(filename).toLowerCase();
      res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.setHeader('Access-Control-Allow-Origin', '*');
      createReadStream(filePath).pipe(res);
    } catch {
      res.status(500).send('Internal error');
    }
  });
  console.log(`   File serving: ${config.baseUri}/files/<filename>`);
  console.log(`   Serving from: ${MCP_FILES_DIR}`);
  console.log('');

  app.use('/', authModule.getRouter());

  console.log('Auth Endpoints:');
  console.log(`   Register Client: POST ${config.baseUri}/register`);
  console.log(`   Authorize:       GET  ${config.baseUri}/authorize`);
  console.log(`   Get Token:       POST ${config.baseUri}/token`);
  console.log(`   Introspect:      POST ${config.baseUri}/introspect`);
  console.log(`   Revoke:          POST ${config.baseUri}/revoke`);

  // MCP module
  const tokenValidator = new InternalTokenValidator(authModule);
  const mcpModule = new MCPModule(
    { baseUri: config.baseUri, redisUrl: config.redis.url },
    tokenValidator
  );
  app.use('/', mcpModule.getRouter());

  console.log('');
  console.log('MCP Endpoints:');
  console.log(`   Streamable HTTP: ${config.baseUri}/mcp`);
  console.log(`   SSE (legacy):    ${config.baseUri}/sse`);
  console.log(`   OAuth Metadata:  ${config.baseUri}/.well-known/oauth-authorization-server`);

  // Splash page
  const splashLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 50,
    message: 'Too many requests',
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.get('/', splashLimiter, (_req, res) => {
    res.send(`<!DOCTYPE html>
<html>
  <head>
    <title>Remote Mac MCP</title>
    <meta charset="utf-8">
    <style>
      body { font-family: system-ui, sans-serif; max-width: 700px; margin: 60px auto; padding: 20px; color: #222; }
      h1 { font-size: 1.6rem; margin-bottom: 4px; }
      .warn { background: #fff3cd; border: 1px solid #ffc107; padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 0.9rem; }
      .ep { background: #f5f5f5; padding: 8px 12px; margin: 4px 0; font-family: monospace; border-radius: 4px; font-size: 0.85rem; }
      a { color: #0066cc; }
    </style>
  </head>
  <body>
    <h1>Remote Mac MCP Server</h1>
    <p style="color:#666;margin-top:0">v1.0.0</p>
    <div class="warn">
      ⚠️ <strong>Security Notice:</strong> This server enables remote shell execution on your Mac.
      Keep your access tokens secure — only expose via an authenticated tunnel (Cloudflare, ngrok, Tailscale).
    </div>
    <h2>Endpoints</h2>
    <div class="ep">POST /mcp — MCP Streamable HTTP (OAuth required)</div>
    <div class="ep">GET  /sse — SSE legacy transport (OAuth required)</div>
    <div class="ep">GET  /.well-known/oauth-authorization-server — OAuth metadata</div>
    <h2>Available Tools</h2>
    <div class="ep">shell_exec — Execute zsh commands on the Mac</div>
    <div class="ep">osascript — Execute AppleScript</div>
    <div class="ep">file_read — Read files or list directories</div>
    <div class="ep">file_write — Write content to files</div>
    <p><a href="/.well-known/oauth-authorization-server">OAuth Metadata</a></p>
  </body>
</html>`);
  });

  // ── Public MCP server ──────────────────────────────────────────────────────
  app.listen(config.port, () => {
    console.log('');
    console.log('========================================');
    console.log(`Server running at: ${config.baseUri}`);
    console.log('========================================');
    console.log('');
  });

  // ── Admin server (localhost only, NOT tunneled) ────────────────────────────
  // 127.0.0.1에만 바인딩 → Cloudflare/ngrok 터널은 이 포트를 프록시하지 않음.
  // `rcmcp auth` 명령어가 이 포트를 통해 PIN을 조회함.
  // PIN은 이 응답 외에 디스크에 저장되지 않음.
  const adminApp = express();
  adminApp.get('/pin', (_req, res) => {
    res.json({ pin: getServerPin() });
  });
  adminApp.listen(ADMIN_PORT, '127.0.0.1', () => {
    console.log(`Admin (localhost only): http://127.0.0.1:${ADMIN_PORT}`);
    console.log('');
  });
}

main().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

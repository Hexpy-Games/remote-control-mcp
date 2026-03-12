import express from 'express';
import { resolve, extname } from 'path';
import { existsSync, statSync, createReadStream } from 'fs';

const PORT = 3835;
const FILES_DIR = resolve(process.env.HOME || '/tmp', 'Public/mcp-files');

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.pdf': 'application/pdf',
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.txt': 'text/plain', '.csv': 'text/csv',
  '.md': 'text/markdown',
};

const app = express();

// 서브디렉토리 포함 전체 경로 지원: /files/reports/xxx.html 등
app.get('/files/*', (req, res) => {
  // req.params[0] = "reports/xxx.html" 또는 "dashboard.html"
  const reqPath = (req.params as Record<string, string>)[0];
  const filePath = resolve(FILES_DIR, reqPath);

  // 디렉토리 탈출 방지
  if (!filePath.startsWith(FILES_DIR)) {
    res.status(403).send('Forbidden');
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.status(404).send('Not found');
    return;
  }

  const stat = statSync(filePath);
  const ext = extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');
  createReadStream(filePath).pipe(res);
});

app.listen(PORT, () => {
  console.log(`File server listening on port ${PORT}`);
  console.log(`Serving files from: ${FILES_DIR}`);
});

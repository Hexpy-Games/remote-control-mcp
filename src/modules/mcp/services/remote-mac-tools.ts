import { z } from "zod/v4";
import { exec } from "child_process";
import { promisify } from "util";
import {
  readFile,
  writeFile,
  readdir,
  stat,
  mkdir,
  mkdtemp,
  rm,
} from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const execAsync = promisify(exec);

type ToolInput = Tool["inputSchema"];
const toJsonSchema = (schema: z.ZodType): ToolInput => {
  return z.toJSONSchema(schema) as ToolInput;
};

// ── Config ──
const MAX_OUTPUT = 100_000;
const COMMAND_TIMEOUT = 30_000;
const SHELL_ENV = {
  ...process.env,
  PATH:
    "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" +
    (process.env.PATH || ""),
};

// ── Security ──
// NOTE: This blocklist is a last-resort safeguard, NOT a security boundary.
// Security is enforced at the OAuth + network tunnel layer.
// Users with valid tokens have intentional shell access — this only blocks
// the most catastrophic accidental/malicious commands.
const USER_BLOCKED = (process.env.BLOCKED_COMMANDS || "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

const DEFAULT_BLOCKED: RegExp[] = [
  /\brm\b.*\s-[a-z]*rf[a-z]*\s+\/[\s*;|&]|\brm\b.*\s-[a-z]*rf[a-z]*\s+\/$/, // rm -rf / or rm -rf /*
  /\brm\b.*\s-[a-z]*fr[a-z]*\s+\/[\s*;|&]|\brm\b.*\s-[a-z]*fr[a-z]*\s+\/$/, // rm -fr / or rm -fr /*
  /--no-preserve-root/,              // explicit root deletion flag
  /mkfs/, // filesystem format
  /dd\s+if=.*of=\/dev\//, // direct disk write
  /:\(\)\s*\{.*\}/, // fork bomb
];

function checkBlocked(command: string): string | null {
  for (const pattern of DEFAULT_BLOCKED) {
    if (pattern.test(command)) return "Blocked: matches security policy";
  }
  if (USER_BLOCKED.some((p) => command.includes(p)))
    return "Blocked: matches user-defined policy";
  return null;
}

// ── Image Support ──
const IMAGE_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};
const IMAGE_MAX_SIZE = 10_000_000;

function getImageMimeType(filePath: string): string | null {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf("."));
  return IMAGE_EXTENSIONS[ext] || null;
}

// ── Schemas ──
const ShellExecSchema = z.object({
  command: z.string().describe("Shell command to execute via zsh"),
  timeout_ms: z.number().optional().describe("Timeout in ms (default 30000)"),
  cwd: z.string().optional().describe("Working directory"),
});
const OsascriptSchema = z.object({
  script: z.string().describe("AppleScript source code to execute"),
});
const FileReadSchema = z.object({
  path: z.string().describe("Absolute file path to read"),
  encoding: z.string().optional().describe("Encoding (default utf-8)"),
});
const FileWriteSchema = z.object({
  path: z.string().describe("Absolute file path to write"),
  content: z.string().describe("Content to write"),
  append: z.boolean().optional().describe("Append mode (default false)"),
});

// ── Async Shell Helper ──
// Uses exec (async) instead of execSync to avoid blocking the event loop.
async function shellExec(
  command: string,
  timeout = COMMAND_TIMEOUT,
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const blocked = checkBlocked(command);
  if (blocked) return { stdout: "", stderr: blocked, exitCode: 1 };

  try {
    const { stdout, stderr } = await execAsync(command, {
      shell: "/bin/zsh",
      timeout,
      maxBuffer: MAX_OUTPUT,
      cwd: cwd || undefined,
      env: SHELL_ENV,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string; code?: number };
    return {
      stdout: e.stdout?.toString() || "",
      stderr: e.stderr?.toString() || e.message || String(err),
      exitCode: e.code ?? 1,
    };
  }
}

// ── Tool Names ──
export enum RemoteToolName {
  SHELL_EXEC = "shell_exec",
  OSASCRIPT = "osascript",
  FILE_READ = "file_read",
  FILE_WRITE = "file_write",
}

// ── Tool Definitions ──
export function getRemoteToolDefinitions(): Tool[] {
  return [
    {
      name: RemoteToolName.SHELL_EXEC,
      description:
        "Execute a zsh command on the remote Mac. Returns stdout, stderr, exitCode.",
      inputSchema: toJsonSchema(ShellExecSchema),
    },
    {
      name: RemoteToolName.OSASCRIPT,
      description:
        "Execute AppleScript on the remote Mac. Can control apps, UI automation, dialogs.",
      inputSchema: toJsonSchema(OsascriptSchema),
    },
    {
      name: RemoteToolName.FILE_READ,
      description:
        "Read file contents or directory listing from the remote Mac.",
      inputSchema: toJsonSchema(FileReadSchema),
    },
    {
      name: RemoteToolName.FILE_WRITE,
      description:
        "Write content to a file on the remote Mac. Creates directories if needed.",
      inputSchema: toJsonSchema(FileWriteSchema),
    },
  ];
}

// ── Tool Handler ──
export async function handleRemoteTool(
  name: string,
  args: Record<string, unknown>
): Promise<{
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
} | null> {
  // ── shell_exec ──
  if (name === RemoteToolName.SHELL_EXEC) {
    const v = ShellExecSchema.parse(args);
    const r = await shellExec(
      v.command,
      v.timeout_ms || COMMAND_TIMEOUT,
      v.cwd
    );
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  }

  // ── osascript ──
  // Uses a private temp directory (mkdtemp) with a quoted path to prevent
  // TOCTOU races and path injection.
  if (name === RemoteToolName.OSASCRIPT) {
    const v = OsascriptSchema.parse(args);
    let tmpDir: string | null = null;
    try {
      tmpDir = await mkdtemp(join(tmpdir(), "mcp-osa-"));
      const tmpFile = join(tmpDir, "script.scpt");
      await writeFile(tmpFile, v.script, "utf-8");
      // Single-quote the path for zsh to prevent injection
      const quoted = `'${tmpFile.replace(/'/g, "'\\''")}'`;
      const r = await shellExec(`osascript ${quoted}`);
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
    }
  }

  // ── file_read ──
  // Uses fs.promises directly — no shell spawning, no injection surface.
  if (name === RemoteToolName.FILE_READ) {
    const v = FileReadSchema.parse(args);
    try {
      let fileStat;
      try {
        fileStat = await stat(v.path);
      } catch {
        return {
          content: [{ type: "text", text: `Error: Not found: ${v.path}` }],
        };
      }

      if (fileStat.isDirectory()) {
        // Use readdir instead of spawning ls
        const entries = await readdir(v.path, { withFileTypes: true });
        const listing = entries
          .map((e) => `${e.isDirectory() ? "d" : "-"} ${e.name}`)
          .join("\n");
        return { content: [{ type: "text", text: listing }] };
      }

      const mimeType = getImageMimeType(v.path);
      if (mimeType) {
        if (fileStat.size > IMAGE_MAX_SIZE)
          return {
            content: [
              {
                type: "text",
                text: `Error: Image too large (${fileStat.size} bytes, max ${IMAGE_MAX_SIZE})`,
              },
            ],
          };
        const data = (await readFile(v.path)).toString("base64");
        return { content: [{ type: "image", data, mimeType }] };
      }

      if (fileStat.size > 5_000_000)
        return {
          content: [
            {
              type: "text",
              text: `Error: Too large (${fileStat.size} bytes)`,
            },
          ],
        };
      const content = await readFile(
        v.path,
        (v.encoding as BufferEncoding) || "utf-8"
      );
      return { content: [{ type: "text", text: content.toString() }] };
    } catch (err: unknown) {
      return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }

  // ── file_write ──
  // Uses fs.promises directly — no shell spawning.
  if (name === RemoteToolName.FILE_WRITE) {
    const v = FileWriteSchema.parse(args);
    try {
      const dir = v.path.substring(0, v.path.lastIndexOf("/"));
      if (dir) await mkdir(dir, { recursive: true });

      if (v.append) {
        const existing = await readFile(v.path, "utf-8").catch(() => "");
        await writeFile(v.path, existing + v.content, "utf-8");
      } else {
        await writeFile(v.path, v.content, "utf-8");
      }
      return {
        content: [
          {
            type: "text",
            text: `OK: ${v.content.length} bytes -> ${v.path}`,
          },
        ],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }

  return null;
}

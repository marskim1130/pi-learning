// 本地安全代码 runner（规格 25）。
//
// 安全边界（每条都是硬约束，不是约定）：
// - 语言白名单由程序定义（SUPPORTED_LANGUAGES），学习者只能选语言，不能指定
//   executable / 参数；
// - 源码写入临时目录（os.tmpdir() 下 pi-learn-*）的固定文件名 main.<ext>，
//   文件名不含任何用户输入（防注入）；
// - cwd 固定为该临时目录，不允许任意 cwd；
// - 子进程 env 是显式白名单 MINIMAL_ENV，不继承完整 process.env，天然满足
//   “不把 API key/敏感 env 传入子进程”；
// - stdout/stderr 各上限 64KB，超出截断（truncated=true）但继续消费防死锁；
// - 超时（默认 8s）kill；结束（含超时/报错/abort）后 finally 清理临时目录。
//
// 已知限制（MVP，规格 25 要求更成熟版本放 Docker/沙箱）：
// - Windows 上 child.kill() 只能终止直接子进程，python 可能留下孤儿进程；
//   升级路径：taskkill /T /F 按进程树杀，或整体移入容器；
// - 无 CPU/内存资源限制：恶意代码可以忙等耗尽本机资源。

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

import type { CodeRunRequest, CodeRunResult } from "../server/protocol.js";

export const DEFAULT_TIMEOUT_MS = 8000;
export const MAX_OUTPUT_BYTES = 64 * 1024;

/** 超时 kill 后等待子进程退出的宽限时间；超过则直接返回 timedOut，避免请求挂起。 */
const KILL_GRACE_MS = 1000;

export interface LanguageConfig {
  /** 要 spawn 的 executable；由程序定义，学习者不可控。 */
  command: string;
  /** 临时目录内源码文件的扩展名。 */
  extension: string;
}

/** 固定允许语言表（规格 25：固定允许语言、命令模板程序定义）。 */
export const SUPPORTED_LANGUAGES: Readonly<Record<string, LanguageConfig>> = {
  python: { command: "python", extension: ".py" },
  node: { command: "node", extension: ".js" }
};

export function isSupportedLanguage(language: string): boolean {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_LANGUAGES, language);
}

/**
 * 子进程环境白名单。Windows 上 spawn 需要 PATH 与系统目录才能定位解释器
 * （SystemRoot/WINDIR/COMSPEC）；TEMP/TMP 给子进程一个可写的临时位置。
 * 明确不继承完整 process.env：API key、token 等敏感变量不会传入子进程。
 */
const MINIMAL_ENV: Readonly<Record<string, string>> = {
  PATH: process.env.PATH ?? "",
  SystemRoot: process.env.SystemRoot ?? "",
  WINDIR: process.env.WINDIR ?? "",
  TEMP: process.env.TEMP ?? "",
  TMP: process.env.TMP ?? "",
  COMSPEC: process.env.COMSPEC ?? ""
};

/** 学习者的代码不能访问的文件系统之外的东西都在这里被隔离。 */
export interface LocalCodeRunnerOptions {
  /** 临时运行目录的父目录。默认 os.tmpdir()；可注入便于测试断言清理。 */
  tmpRoot?: string;
  /** 语言表覆盖（测试 seam，合并到内置白名单之上）。 */
  languages?: Record<string, LanguageConfig>;
}

export interface CodeRunner {
  run(request: CodeRunRequest, signal?: AbortSignal): Promise<CodeRunResult>;
}

/** 运行时缺失（spawn ENOENT）时的专用错误，server 映射为 503 runtime_unavailable。 */
export class CodeRunUnavailableError extends Error {
  readonly language: string;

  constructor(language: string) {
    super(`Runtime for "${language}" is not available on this machine.`);
    this.name = "CodeRunUnavailableError";
    this.language = language;
  }
}

/** 按 64KB 上限截断收集一个输出流；截断后仍持续消费（防背压死锁）。 */
class OutputCollector {
  text = "";
  truncated = false;
  private readonly decoder = new StringDecoder("utf8");
  private remaining = MAX_OUTPUT_BYTES;

  push(chunk: Buffer): void {
    if (this.truncated) {
      return; // 仍在消费（防死锁），但不再缓冲
    }
    if (chunk.length > this.remaining) {
      this.truncated = true;
    }
    const keep = Math.min(chunk.length, this.remaining);
    if (keep > 0) {
      this.text += this.decoder.write(chunk.subarray(0, keep));
    }
    this.remaining -= chunk.length;
  }

  end(): void {
    this.text += this.decoder.end();
  }
}

export class LocalCodeRunner implements CodeRunner {
  private readonly languages: Readonly<Record<string, LanguageConfig | undefined>>;
  private readonly tmpRoot: string;

  constructor(options: LocalCodeRunnerOptions = {}) {
    this.languages = { ...SUPPORTED_LANGUAGES, ...options.languages };
    this.tmpRoot = options.tmpRoot ?? tmpdir();
  }

  async run(request: CodeRunRequest, signal?: AbortSignal): Promise<CodeRunResult> {
    const config = Object.prototype.hasOwnProperty.call(this.languages, request.language)
      ? this.languages[request.language]
      : undefined;
    if (config === undefined) {
      throw new Error(`Unsupported language: ${request.language}.`);
    }
    const startedAt = Date.now();
    const tmpDir = await mkdtemp(path.join(this.tmpRoot, "pi-learn-"));
    try {
      const filePath = path.join(tmpDir, `main${config.extension}`);
      await writeFile(filePath, request.code, "utf8");
      return await this.runProcess(
        config.command,
        filePath,
        request.language,
        tmpDir,
        request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal,
        startedAt
      );
    } finally {
      // 超时/报错/abort 路径也要清理；rm 失败（Windows 上孤儿进程占用文件）
      // 只记录，不掩盖原始错误。
      await rm(tmpDir, { recursive: true, force: true }).catch((error: unknown) => {
        console.warn("[pi-learning] failed to clean up run dir:", tmpDir, error);
      });
    }
  }

  private runProcess(
    command: string,
    filePath: string,
    language: string,
    cwd: string,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    startedAt: number
  ): Promise<CodeRunResult> {
    return new Promise<CodeRunResult>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(command, [filePath], {
          cwd,
          env: MINIMAL_ENV,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true
        });
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;
      let timedOut = false;
      let timer: NodeJS.Timeout | undefined;
      let graceTimer: NodeJS.Timeout | undefined;

      const finish = (result: CodeRunResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        clearTimeout(graceTimer);
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };

      const fail = (error: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        clearTimeout(graceTimer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      };

      // abort 是调用方取消 → reject；超时是正常结果 → timedOut=true。二者语义不同。
      const onAbort = (): void => {
        child.kill();
        fail(new Error("Code run aborted."));
      };

      const onTimeout = (): void => {
        timedOut = true;
        child.kill();
        // Windows 上 kill 可能杀不掉（python 留孤儿）；最多再等 KILL_GRACE_MS，
        // 之后直接 resolve timedOut，避免请求挂起。kill 后若子进程很快退出，
        // close 分支会带着真实 exitCode 先 settle。
        graceTimer = setTimeout(() => {
          finish({
            exitCode: null,
            stdout: stdout.text,
            stderr: stderr.text,
            timedOut: true,
            durationMs: Date.now() - startedAt,
            truncated: stdout.truncated || stderr.truncated
          });
        }, KILL_GRACE_MS);
      };

      const stdout = new OutputCollector();
      const stderr = new OutputCollector();
      child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stdout?.on("error", fail);
      child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.stderr?.on("error", fail);

      child.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          fail(new CodeRunUnavailableError(language));
          return;
        }
        fail(error);
      });

      // close 在 stdio 全部关闭后触发，比 exit 可靠（exit 可能先于 stdout 结束）。
      child.once("close", (exitCode) => {
        stdout.end();
        stderr.end();
        finish({
          exitCode: exitCode ?? null,
          stdout: stdout.text,
          stderr: stderr.text,
          timedOut,
          durationMs: Date.now() - startedAt,
          truncated: stdout.truncated || stderr.truncated
        });
      });

      timer = setTimeout(onTimeout, timeoutMs);
      if (signal !== undefined) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }
}

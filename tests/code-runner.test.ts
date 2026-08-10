// 本地代码 runner 测试（规格 25）：真跑本机 node/python，验证安全边界。
// 所有用例都有 15s 兜底超时，spawn 不会悬挂。

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CodeRunUnavailableError,
  LocalCodeRunner,
  MAX_OUTPUT_BYTES
} from "../extension/runner/code-runner.js";

const runner = new LocalCodeRunner();

async function isAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], { stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 3000);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

const pythonAvailable = await isAvailable("python");

describe("LocalCodeRunner", { timeout: 15_000 }, () => {
  it("runs node hello world with exit code 0", async () => {
    const result = await runner.run({
      language: "node",
      code: 'console.log("hello")'
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports a non-zero exit code", async () => {
    const result = await runner.run({ language: "node", code: "process.exit(3)" });
    expect(result.exitCode).toBe(3);
  });

  it("captures stderr", async () => {
    const result = await runner.run({ language: "node", code: 'console.error("boom")' });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("boom\n");
  });

  it("times out long-running code (timedOut=true, no hang)", async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "pi-learn-test-"));
    try {
      const scoped = new LocalCodeRunner({ tmpRoot });
      const result = await scoped.run({
        language: "node",
        code: "setTimeout(() => {}, 10000)",
        timeoutMs: 300
      });
      expect(result.timedOut).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(300);
      expect(result.durationMs).toBeLessThan(5000);
      // 超时路径也清理临时目录。
      expect(readdirSync(tmpRoot)).toEqual([]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("aborts on AbortSignal and rejects", async () => {
    const controller = new AbortController();
    const pending = runner.run(
      { language: "node", code: "setTimeout(() => {}, 5000)" },
      controller.signal
    );
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toThrow(/aborted/i);
  });

  it("truncates oversized output but still drains and completes", async () => {
    const result = await runner.run({
      language: "node",
      code: 'console.log("x".repeat(200 * 1024))'
    });
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
    expect(result.stdout.startsWith("x")).toBe(true);
  });

  it("does not leak host env into the child (allowlist only)", async () => {
    process.env.FAKE_API_KEY = "super-secret";
    try {
      const result = await runner.run({
        language: "node",
        code: "console.log(JSON.stringify(Object.keys(process.env).sort()))"
      });
      expect(result.exitCode).toBe(0);
      const keys = JSON.parse(result.stdout) as string[];
      expect(keys).not.toContain("FAKE_API_KEY");
      expect(keys).toContain("PATH");
    } finally {
      delete process.env.FAKE_API_KEY;
    }
  });

  it("cleans up the temp directory after a run", async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "pi-learn-test-"));
    try {
      const scoped = new LocalCodeRunner({ tmpRoot });
      await scoped.run({ language: "node", code: "console.log(1)" });
      expect(readdirSync(tmpRoot)).toEqual([]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("throws CodeRunUnavailableError when the runtime is missing (ENOENT)", async () => {
    const scoped = new LocalCodeRunner({
      languages: {
        bogus: { command: "pi-learn-no-such-runtime", extension: ".js" }
      }
    });
    await expect(
      scoped.run({ language: "bogus", code: "console.log(1)" })
    ).rejects.toBeInstanceOf(CodeRunUnavailableError);
    await expect(
      scoped.run({ language: "bogus", code: "console.log(1)" })
    ).rejects.toMatchObject({ language: "bogus" });
  });

  it("rejects languages outside the whitelist", async () => {
    await expect(runner.run({ language: "ruby", code: "puts 1" })).rejects.toThrow(
      /Unsupported language: ruby/
    );
  });

  it.skipIf(!pythonAvailable)("runs python when the interpreter is available", async () => {
    const result = await runner.run({ language: "python", code: 'print("hi")' });
    expect(result.exitCode).toBe(0);
    // Windows 上 python 用 os.linesep（\r\n）换行。
    expect(result.stdout.replace(/\r\n/g, "\n")).toBe("hi\n");
  });
});

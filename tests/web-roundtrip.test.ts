// Web 工作台完整往返（规格 9.4）：present → SSE presented → POST submit → SSE
// resolved → pending 清空。外加静态伺服补充 traversal 向量与 /api/* 鉴权。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InteractionBroker } from "../extension/server/interaction-broker.js";
import { LearningServer } from "../extension/server/learning-server.js";
import type { LearningInteraction } from "../extension/server/protocol.js";
import { LearningStateStore } from "../extension/state/learning-state.js";

const TOKEN = "web-roundtrip-token";

function singleChoiceInteraction(id: string): LearningInteraction {
  return {
    id,
    type: "single_choice",
    question: `Question ${id}`,
    options: [
      { id: "A", label: "First" },
      { id: "B", label: "Second" }
    ],
    allowSkip: true,
    createdAt: Date.now()
  };
}

function multiChoiceInteraction(id: string): LearningInteraction {
  return {
    id,
    type: "multi_choice",
    question: `Question ${id}`,
    options: [
      { id: "A", label: "First" },
      { id: "B", label: "Second" },
      { id: "C", label: "Third" }
    ],
    allowSkip: false,
    createdAt: Date.now()
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

class SseReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = "";

  constructor(body: ReadableStream<Uint8Array> | null) {
    if (body === null) throw new Error("no body");
    this.reader = body.getReader();
  }

  async waitFor(predicate: (d: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    for (;;) {
      const sep = this.buffer.indexOf("\n\n");
      if (sep !== -1) {
        const frame = this.buffer.slice(0, sep);
        this.buffer = this.buffer.slice(sep + 2);
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (dataLine === undefined) continue;
        const data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
        if (predicate(data)) return data;
        continue;
      }
      const { done, value } = await withTimeout(this.reader.read(), 5000);
      if (done) throw new Error("SSE stream ended early");
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

  async close(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
  }
}

describe("Web workspace round trip", () => {
  let broker: InteractionBroker;
  let state: LearningStateStore;
  let server: LearningServer;
  let origin: string;
  const headers = { Authorization: `Bearer ${TOKEN}` };

  beforeEach(async () => {
    broker = new InteractionBroker();
    state = new LearningStateStore();
    server = new LearningServer({ broker, state, token: TOKEN });
    await server.start();
    origin = new URL(server.url() ?? "").origin;
  });

  afterEach(async () => {
    await server.close();
  });

  it("completes present → SSE presented → submit → SSE resolved → pending empty (spec 9.4)", async () => {
    const response = await fetch(`${origin}/api/events?token=${TOKEN}`, { headers });
    expect(response.status).toBe(200);
    const sse = new SseReader(response.body);

    // GET /api/session + /api/interactions/pending 均需 token（spec 31）。
    expect((await fetch(`${origin}/api/session`)).status).toBe(401);
    expect((await fetch(`${origin}/api/interactions/pending`)).status).toBe(401);
    expect((await fetch(`${origin}/api/session`, { headers })).status).toBe(200);

    // present 后 SSE 收到 presented，形状与前端 protocol 一致。
    const interaction = singleChoiceInteraction("web_rt_1");
    const presentedPromise = sse.waitFor(
      (d) => d.event === "interaction.presented" && (d.interaction as { id?: string }).id === interaction.id
    );
    const presentation = broker.present(interaction);
    const presented = await presentedPromise;
    const wire = presented.interaction as Record<string, unknown>;
    expect(wire.allowSkip).toBe(true);
    expect(typeof wire.createdAt).toBe("number");
    expect((wire.options as Array<{ id: string; label: string }>)[0]?.id).toBe("A");
    expect(wire.question).toBe("Question web_rt_1");

    // 刷新恢复路径（spec 9.4 step 2）：pending 里有它。
    const pendingRes = await fetch(`${origin}/api/interactions/pending`, { headers });
    const pending = (await pendingRes.json()) as { interactions: unknown[] };
    expect(pending.interactions).toHaveLength(1);

    // 提交 → 200 + resolved SSE → pending 清空 → 重复提交 409。
    const resolvedPromise = sse.waitFor(
      (d) => d.event === "interaction.resolved" && d.interactionId === interaction.id
    );
    const submitRes = await fetch(
      `${origin}/api/interactions/${interaction.id}/submit`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          interactionId: interaction.id,
          answer: { optionId: "B" },
          clientTimestamp: Date.now()
        })
      }
    );
    expect(submitRes.status).toBe(200);
    const submitBody = (await submitRes.json()) as { ok: boolean; answer: { type: string } };
    expect(submitBody.ok).toBe(true);
    expect(submitBody.answer.type).toBe("single_choice");

    const resolved = await resolvedPromise;
    const answer = resolved.answer as { answer: { optionId: string } };
    expect(answer.answer.optionId).toBe("B");

    const emptyRes = await fetch(`${origin}/api/interactions/pending`, { headers });
    expect(((await emptyRes.json()) as { interactions: unknown[] }).interactions).toEqual([]);

    const duplicateRes = await fetch(
      `${origin}/api/interactions/${interaction.id}/submit`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          interactionId: interaction.id,
          answer: { optionId: "A" },
          clientTimestamp: Date.now()
        })
      }
    );
    expect(duplicateRes.status).toBe(409);

    await presentation;
    await sse.close();
  });

  it("completes a multi_choice round trip with ordered optionIds and duplicate-submit 409 (spec 7.6/22)", async () => {
    const response = await fetch(`${origin}/api/events?token=${TOKEN}`, { headers });
    expect(response.status).toBe(200);
    const sse = new SseReader(response.body);

    // present → SSE presented，wire 形状与前端 protocol.ts 一致。
    const interaction = multiChoiceInteraction("web_rt_multi_1");
    const presentedPromise = sse.waitFor(
      (d) => d.event === "interaction.presented" && (d.interaction as { id?: string }).id === interaction.id
    );
    const presentation = broker.present(interaction);
    const presented = await presentedPromise;
    const wire = presented.interaction as Record<string, unknown>;
    expect(wire.type).toBe("multi_choice");
    expect(wire.allowSkip).toBe(false);
    expect((wire.options as Array<{ id: string }>).map((o) => o.id)).toEqual(["A", "B", "C"]);

    // 提交顺序保持原样（规格 22：顺序不应影响语义，服务端不去重排序）。
    const resolvedPromise = sse.waitFor(
      (d) => d.event === "interaction.resolved" && d.interactionId === interaction.id
    );
    const submitRes = await fetch(
      `${origin}/api/interactions/${interaction.id}/submit`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          interactionId: interaction.id,
          answer: { optionIds: ["C", "A"] },
          clientTimestamp: Date.now()
        })
      }
    );
    expect(submitRes.status).toBe(200);
    const submitBody = (await submitRes.json()) as {
      ok: boolean;
      answer: { type: string; answer: { optionIds: string[] } };
    };
    expect(submitBody.ok).toBe(true);
    expect(submitBody.answer.type).toBe("multi_choice");
    expect(submitBody.answer.answer.optionIds).toEqual(["C", "A"]);

    const resolved = await resolvedPromise;
    expect(
      (resolved.answer as { answer: { optionIds: string[] } }).answer.optionIds
    ).toEqual(["C", "A"]);

    // pending 清空，重复提交 409。
    const emptyRes = await fetch(`${origin}/api/interactions/pending`, { headers });
    expect(((await emptyRes.json()) as { interactions: unknown[] }).interactions).toEqual([]);
    const duplicateRes = await fetch(
      `${origin}/api/interactions/${interaction.id}/submit`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          interactionId: interaction.id,
          answer: { optionIds: ["A"] },
          clientTimestamp: Date.now()
        })
      }
    );
    expect(duplicateRes.status).toBe(409);

    await presentation;
    await sse.close();
  });

  it("blocks encoded traversal variants that would escape the dist root (spec 31)", async () => {
    // secret.txt 放在 distRoot 之外（tmpdir 里）：任何能读到它的路径都是逃逸。
    const distRoot = mkdtempSync(path.join(tmpdir(), "pi-learning-web-qa-"));
    const secretPath = path.join(path.dirname(distRoot), "pi-learning-web-qa-secret.txt");
    writeFileSync(secretPath, "secret");
    try {
      mkdirSync(path.join(distRoot, "assets"), { recursive: true });
      writeFileSync(path.join(distRoot, "index.html"), "<title>rt</title>");
      writeFileSync(path.join(distRoot, "assets", "app.js"), "fixture");

      const staticServer = new LearningServer({
        broker,
        state,
        token: TOKEN,
        staticRoot: distRoot
      });
      await staticServer.start();
      const staticOrigin = new URL(staticServer.url() ?? "").origin;
      const status = async (p: string): Promise<number> =>
        (await fetch(`${staticOrigin}${p}`)).status;
      try {
        // 正常资源可读。
        expect(await status("/assets/app.js")).toBe(200);
        // 各种编码的 ../ 逃逸（目标文件真实存在且在 root 外）。
        expect(await status("/../secret.txt")).toBe(404);
        expect(await status("/assets/../../secret.txt")).toBe(404);
        expect(await status("/assets/%2e%2e/%2e%2e/secret.txt")).toBe(404);
        expect(await status("/%2e%2e/secret.txt")).toBe(404);
        expect(await status("/%2e%2e%2fsecret.txt")).toBe(404);
        expect(await status("/..%2fsecret.txt")).toBe(404);
        // 双重编码不产生二次解码逃逸。
        expect(await status("/%252e%252e/secret.txt")).toBe(404);
        // 反斜杠编码（Windows 分隔符）不得逃逸；\..\.. 到 root 外必须 404。
        expect(await status("/assets%5c..%5c..%5csecret.txt")).toBe(404);
        // 非 GET 对静态资源拒绝。
        const postRes = await fetch(`${staticOrigin}/assets/app.js`, { method: "POST" });
        expect(postRes.status).toBe(404);
        // /api/* 仍要求 token（静态服务不绕过鉴权）。
        expect((await fetch(`${staticOrigin}/api/health`)).status).toBe(401);
        expect((await fetch(`${staticOrigin}/api/health`, { headers })).status).toBe(200);
      } finally {
        await staticServer.close();
      }
    } finally {
      rmSync(distRoot, { recursive: true, force: true });
      rmSync(secretPath, { force: true });
    }
  });
});

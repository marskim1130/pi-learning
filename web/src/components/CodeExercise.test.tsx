// @vitest-environment jsdom
// 代码练习组件（规格 24/25）：Monaco 在 jsdom 下无法真实渲染，vi.mock
// @monaco-editor/react 为轻量 textarea stub；断言 draft 恢复、Run/Submit、
// Ctrl+Enter 命令与 readOnlyRanges 编辑过滤（规格 7.8）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import CodeExercise from "./CodeExercise";
import { client } from "../api/client";
import type { CodeExerciseInteraction } from "../types/protocol";

afterEach(cleanup);

// 共享的 Monaco 假模型/编辑器：applyReadOnlyRanges 会包住 model.pushEditOperations，
// 测试通过 fake.model 调用验证过滤行为。
const fake = vi.hoisted(() => {
  class Range {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;

    constructor(
      startLineNumber: number,
      startColumn: number,
      endLineNumber: number,
      endColumn: number
    ) {
      this.startLineNumber = startLineNumber;
      this.startColumn = startColumn;
      this.endLineNumber = endLineNumber;
      this.endColumn = endColumn;
    }

    static intersectRanges(
      a: Range,
      b: Range
    ): Range | null {
      const startLine = Math.max(a.startLineNumber, b.startLineNumber);
      const endLine = Math.min(a.endLineNumber, b.endLineNumber);
      const startCol = Math.max(a.startColumn, b.startColumn);
      const endCol = Math.min(a.endColumn, b.endColumn);
      if (startLine > endLine || startCol > endCol) {
        return null;
      }
      return new Range(startLine, startCol, endLine, endCol);
    }
  }

  const applyEdits = vi.fn((ops: unknown[]) => ops);
  const pushEditOperations = vi.fn(
    (_before: unknown, ops: unknown[]) => applyEdits(ops)
  );
  const model = {
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    pushEditOperations,
    applyEdits
  };
  const addCommand = vi.fn();
  const editor = {
    addCommand,
    createDecorationsCollection: vi.fn(() => ({})),
    getModel: () => model
  };
  return { Range, model, editor, addCommand, applyEdits, pushEditOperations };
});

vi.mock("monaco-editor", () => ({
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { Enter: 3 },
  Range: fake.Range
}));

vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");
  return {
    loader: { config: vi.fn() },
    default: (props: {
      value?: string;
      onChange?: (value: string | undefined) => void;
      onMount?: (editor: unknown) => void;
    }) => {
      React.useEffect(() => {
        props.onMount?.(fake.editor);
      }, []);
      return React.createElement("textarea", {
        "data-testid": "code-editor",
        value: props.value ?? "",
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          props.onChange?.(event.target.value)
      });
    }
  };
});

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {},
  getToken: () => null,
  describeSubmitError: (error: unknown) =>
    error instanceof Error ? error.message : "提交失败，请重试。",
  describeRunError: () => "运行失败，请重试。",
  client: { submit: vi.fn(), runCode: vi.fn() }
}));

const submit = vi.mocked(client.submit);
const runCode = vi.mocked(client.runCode);

function interaction(
  overrides: Partial<CodeExerciseInteraction> = {}
): CodeExerciseInteraction {
  return {
    id: "code_1",
    type: "code",
    instructions: "实现一个函数。",
    language: "python",
    starterCode: "def f():\n    return 1",
    createdAt: 1_000,
    ...overrides
  };
}

beforeEach(() => {
  localStorage.clear();
  submit.mockReset();
  runCode.mockReset();
  fake.applyEdits.mockClear();
  fake.pushEditOperations.mockClear();
  fake.addCommand.mockClear();
  fake.model.pushEditOperations = fake.pushEditOperations;
  submit.mockResolvedValue({
    ok: true,
    answer: {
      interactionId: "code_1",
      type: "code",
      answer: { language: "python", code: "def f():\n    return 1" },
      responseTimeMs: 5
    }
  });
  runCode.mockResolvedValue({
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 3,
    timedOut: false,
    truncated: false
  });
});

describe("CodeExercise", () => {
  it("restores the draft and renders Run/Submit buttons", () => {
    localStorage.setItem("pi_draft_code_1", "print(1)");
    render(<CodeExercise interaction={interaction()} />);

    expect((screen.getByTestId("code-editor") as HTMLTextAreaElement).value).toBe(
      "print(1)"
    );
    expect(screen.getByRole("button", { name: "运行" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "提交" })).toBeTruthy();
  });

  it("runs code locally without submitting", async () => {
    render(<CodeExercise interaction={interaction()} />);
    const textarea = screen.getByTestId("code-editor") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "print(42)" } });

    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    await waitFor(() =>
      expect(runCode).toHaveBeenCalledWith("python", "print(42)")
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits via the Ctrl+Enter editor command", async () => {
    render(<CodeExercise interaction={interaction()} />);
    const textarea = screen.getByTestId("code-editor") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "print(1)" } });

    const command = fake.addCommand.mock.calls[0]?.[1] as () => void;
    command();

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("code_1", {
        language: "python",
        code: "print(1)"
      })
    );
  });

  it("resets to the starter code", () => {
    render(<CodeExercise interaction={interaction()} />);
    const textarea = screen.getByTestId("code-editor") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "changed" } });
    expect(textarea.value).toBe("changed");

    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    expect(textarea.value).toBe("def f():\n    return 1");
  });

  it("blocks edits inside read-only ranges and allows edits outside", () => {
    render(
      <CodeExercise
        interaction={interaction({
          starterCode: "abcdefgh",
          readOnlyRanges: [{ start: 0, end: 7 }]
        })}
      />
    );

    // 只读区（offset 0..7 → 第 1 行 1..8 列）内的编辑被丢弃。
    fake.model.pushEditOperations(null, [
      { range: new fake.Range(1, 1, 1, 3), text: "X" }
    ]);
    expect(fake.applyEdits).toHaveBeenLastCalledWith([]);

    // 只读区外的编辑正常放行。
    fake.model.pushEditOperations(null, [
      { range: new fake.Range(1, 9, 1, 9), text: "!" }
    ]);
    expect(fake.applyEdits).toHaveBeenLastCalledWith([
      { range: new fake.Range(1, 9, 1, 9), text: "!" }
    ]);
  });
});

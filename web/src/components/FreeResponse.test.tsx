// @vitest-environment jsdom
// 自由回答组件（规格 23）：draft 恢复、Ctrl+Enter 提交、单行 Enter 提交。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import FreeResponse from "./FreeResponse";
import { client } from "../api/client";
import type { FreeResponseInteraction } from "../types/protocol";

afterEach(cleanup);

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {},
  getToken: () => null,
  describeSubmitError: (error: unknown) =>
    error instanceof Error ? error.message : "提交失败，请重试。",
  describeRunError: () => "运行失败，请重试。",
  client: { submit: vi.fn(), runCode: vi.fn() }
}));

const submit = vi.mocked(client.submit);

beforeEach(() => {
  localStorage.clear();
  submit.mockReset();
  submit.mockResolvedValue({
    ok: true,
    answer: {
      interactionId: "fr_1",
      type: "free_response",
      answer: { text: "答案" },
      responseTimeMs: 5
    }
  });
});

function interaction(overrides: Partial<FreeResponseInteraction> = {}): FreeResponseInteraction {
  return {
    id: "fr_1",
    type: "free_response",
    question: "什么是泛型？",
    multiline: true,
    createdAt: 1_000,
    ...overrides
  };
}

describe("FreeResponse", () => {
  it("restores the draft from localStorage", () => {
    localStorage.setItem("pi_draft_fr_1", "草稿内容");
    render(<FreeResponse interaction={interaction()} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("草稿内容");
    expect(
      (screen.getByRole("button", { name: "提交答案" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it("submits on Ctrl+Enter and clears the draft", async () => {
    render(<FreeResponse interaction={interaction()} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: " 我的回答 " } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("fr_1", { text: "我的回答" })
    );
    expect(localStorage.getItem("pi_draft_fr_1")).toBeNull();
  });

  it("does not submit on plain Enter in the multiline textarea", () => {
    render(<FreeResponse interaction={interaction()} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "回答" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits on Enter in the single-line input", async () => {
    render(<FreeResponse interaction={interaction({ multiline: false })} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "单行回答" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("fr_1", { text: "单行回答" })
    );
  });
});

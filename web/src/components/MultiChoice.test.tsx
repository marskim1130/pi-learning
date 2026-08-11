// @vitest-environment jsdom
// 多选组件（规格 22）：零选禁用提交、多选切换、提交 payload optionIds。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import MultiChoice from "./MultiChoice";
import { client } from "../api/client";
import type { MultiChoiceInteraction } from "../types/protocol";

afterEach(cleanup);

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {},
  getToken: () => null,
  describeSubmitError: (error: unknown) =>
    error instanceof Error ? error.message : "提交失败，请重试。",
  describeRunError: () => "运行失败，请重试。",
  client: { submit: vi.fn(), skip: vi.fn(), runCode: vi.fn() }
}));

const interaction: MultiChoiceInteraction = {
  id: "mc_1",
  type: "multi_choice",
  question: "哪些声明是泛型？",
  options: [
    { id: "A", label: "impl<T> Container<T>" },
    { id: "B", label: "fn id(value)" },
    { id: "C", label: "fn id<T>(value: T)" }
  ],
  allowSkip: false,
  createdAt: 1_000
};

const submit = vi.mocked(client.submit);
const skip = vi.mocked(client.skip);

beforeEach(() => {
  submit.mockReset();
  submit.mockResolvedValue({
    ok: true,
    answer: {
      interactionId: "mc_1",
      type: "multi_choice",
      answer: { optionIds: ["A", "C"] },
      responseTimeMs: 5
    }
  });
  skip.mockReset();
  skip.mockResolvedValue({
    ok: true,
    answer: {
      interactionId: "mc_1",
      type: "multi_choice",
      skipped: true,
      responseTimeMs: 5
    }
  });
});

describe("MultiChoice", () => {
  it("disables submit with zero selections and toggles options", () => {
    render(<MultiChoice interaction={interaction} />);

    const button = screen.getByRole("button", { name: "提交答案" });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    const radioA = screen.getByRole("checkbox", {
      name: /impl<T> Container<T>/
    });
    const radioC = screen.getByRole("checkbox", {
      name: /fn id<T>\(value: T\)/
    });
    fireEvent.click(radioA);
    fireEvent.click(radioC);
    expect((radioA as HTMLInputElement).checked).toBe(true);
    expect((radioC as HTMLInputElement).checked).toBe(true);
    expect((button as HTMLButtonElement).disabled).toBe(false);

    // 再点 A 取消选择。
    fireEvent.click(radioA);
    expect((radioA as HTMLInputElement).checked).toBe(false);
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits the selected option ids", async () => {
    render(<MultiChoice interaction={interaction} />);

    fireEvent.click(
      screen.getByRole("checkbox", { name: /impl<T> Container<T>/ })
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /fn id<T>\(value: T\)/ })
    );
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("mc_1", { optionIds: ["A", "C"] })
    );
  });

  it("toggles options with digit keys and submits with Enter", async () => {
    render(<MultiChoice interaction={interaction} />);
    const group = screen.getByRole("group", { name: "选项（可多选）" });

    fireEvent.keyDown(group, { key: "1" });
    fireEvent.keyDown(group, { key: "3" });
    expect(
      (
        screen.getByRole("checkbox", { name: /impl<T> Container<T>/ }) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect(submit).not.toHaveBeenCalled();

    fireEvent.keyDown(group, { key: "Enter" });
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("mc_1", { optionIds: ["A", "C"] })
    );
  });

  it("hides the skip button unless allowSkip is set", () => {
    render(<MultiChoice interaction={interaction} />);
    expect(screen.queryByRole("button", { name: "跳过此题" })).toBeNull();
  });

  it("skips without requiring a selection when allowSkip is set", async () => {
    render(<MultiChoice interaction={{ ...interaction, allowSkip: true }} />);

    const submitButton = screen.getByRole("button", { name: "提交答案" });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "跳过此题" }));

    await waitFor(() => expect(skip).toHaveBeenCalledWith("mc_1"));
    expect(submit).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "跳过此题" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
});

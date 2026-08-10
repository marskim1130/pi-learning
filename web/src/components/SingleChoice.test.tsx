// @vitest-environment jsdom
// 单选组件（规格 21）：点击选中、显式提交、提交后锁定、键盘选择与 Enter 提交。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import SingleChoice from "./SingleChoice";
import { client } from "../api/client";
import type { SingleChoiceInteraction } from "../types/protocol";

afterEach(cleanup);

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {},
  getToken: () => null,
  describeSubmitError: (error: unknown) =>
    error instanceof Error ? error.message : "提交失败，请重试。",
  describeRunError: () => "运行失败，请重试。",
  client: { submit: vi.fn(), runCode: vi.fn() }
}));

const interaction: SingleChoiceInteraction = {
  id: "sc_1",
  type: "single_choice",
  question: "哪个声明是泛型？",
  options: [
    { id: "A", label: "struct Container" },
    { id: "B", label: "impl<T> Container<T>" },
    { id: "C", label: "fn id(value)" }
  ],
  allowSkip: false,
  createdAt: 1_000
};

const submit = vi.mocked(client.submit);

beforeEach(() => {
  submit.mockReset();
  submit.mockResolvedValue({
    ok: true,
    answer: {
      interactionId: "sc_1",
      type: "single_choice",
      answer: { optionId: "A" },
      responseTimeMs: 5
    }
  });
});

describe("SingleChoice", () => {
  it("renders options; clicking selects without submitting", () => {
    render(<SingleChoice interaction={interaction} />);

    expect(screen.getByText("impl<T> Container<T>")).toBeTruthy();
    const button = screen.getByRole("button", { name: "提交答案" });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    const radio = screen.getByRole("radio", {
      name: /impl<T> Container<T>/
    });
    fireEvent.click(radio);
    expect((radio as HTMLInputElement).checked).toBe(true);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits the selected option and locks after submit", async () => {
    render(<SingleChoice interaction={interaction} />);

    fireEvent.click(
      screen.getByRole("radio", { name: /struct Container/ })
    );
    fireEvent.click(screen.getByRole("button", { name: "提交答案" }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("sc_1", { optionId: "A" })
    );
    // 提交成功后组件保持锁定（submitting 不再复位；真实流程由父层移除交互）。
    expect(
      (screen.getByRole("button", { name: "提交中…" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole("radio", { name: /struct Container/ }) as HTMLInputElement)
        .disabled
    ).toBe(true);
  });

  it("selects with digit keys and submits with Enter", async () => {
    render(<SingleChoice interaction={interaction} />);
    const group = screen.getByRole("group", { name: "选项" });

    fireEvent.keyDown(group, { key: "2" });
    expect(
      (screen.getByRole("radio", { name: /impl<T> Container<T>/ }) as HTMLInputElement)
        .checked
    ).toBe(true);
    // 数字键只选中，不提交。
    expect(submit).not.toHaveBeenCalled();

    fireEvent.keyDown(group, { key: "Enter" });
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("sc_1", { optionId: "B" })
    );
  });
});

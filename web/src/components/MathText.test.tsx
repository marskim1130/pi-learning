// @vitest-environment jsdom
// KaTeX 渲染（规格 20/26）：分段逻辑、renderToString 输出、TutorTranscript 集成。
import { describe, expect, it } from "vitest";
import { afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import MathText, { renderSegments, splitMathSegments } from "./MathText";
import TutorTranscript from "./TutorTranscript";
import { useLearningWorkspace } from "../state/store";

afterEach(cleanup);

describe("splitMathSegments", () => {
  it("splits inline math while keeping surrounding text order", () => {
    expect(splitMathSegments("半径 $r$ 与面积 $A$ 的关系")).toEqual([
      { type: "text", content: "半径 " },
      { type: "math", content: "r", block: false },
      { type: "text", content: " 与面积 " },
      { type: "math", content: "A", block: false },
      { type: "text", content: " 的关系" }
    ]);
  });

  it("treats $$...$$ as block math even on one line", () => {
    expect(splitMathSegments("前 $$x^2$$ 后")).toEqual([
      { type: "text", content: "前 " },
      { type: "math", content: "x^2", block: true },
      { type: "text", content: " 后" }
    ]);
  });

  it("keeps plain text as a single segment", () => {
    expect(splitMathSegments("没有公式")).toEqual([
      { type: "text", content: "没有公式" }
    ]);
  });

  it("does not choke on an unmatched dollar sign", () => {
    expect(splitMathSegments("价格 $5 元")).toEqual([
      { type: "text", content: "价格 $5 元" }
    ]);
  });
});

describe("renderSegments", () => {
  it("renders math with KaTeX and keeps text as-is", () => {
    const html = renderSegments(
      splitMathSegments("面积 $A=\\pi r^2$ 平方")
    );
    expect(html).toContain("面积");
    expect(html).toContain("<span class=\"katex\"");
    expect(html).toContain("\\pi r^2");
  });

  it("renders block math in display mode", () => {
    const html = renderSegments(
      splitMathSegments("$$\\frac{1}{2}$$")
    );
    expect(html).toContain("katex-display");
  });
});

describe("TutorTranscript math integration", () => {
  it("renders inline and block math from a tutor message", () => {
    useLearningWorkspace.setState({
      transcript: [
        {
          id: "t1",
          kind: "tutor_message",
          role: "assistant",
          text: "公式 $x^2$ 与 $$y^3$$ 都成立。",
          time: 1_000
        }
      ]
    });
    render(<TutorTranscript />);

    expect(screen.getByText("公式")).toBeTruthy();
    expect(document.querySelectorAll(".katex").length).toBe(2);
    expect(document.querySelector(".katex-display")).toBeTruthy();
  });

  it("still renders markdown in non-math segments", () => {
    useLearningWorkspace.setState({
      transcript: [
        {
          id: "t2",
          kind: "tutor_message",
          role: "assistant",
          text: "**重点**：$x$ 是未知数。",
          time: 1_000
        }
      ]
    });
    render(<TutorTranscript />);

    expect(document.querySelector("strong")?.textContent).toBe("重点");
    expect(document.querySelectorAll(".katex").length).toBe(1);
  });
});

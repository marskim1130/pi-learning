// @vitest-environment jsdom
// KaTeX 渲染（规格 20/26）：分段逻辑、renderToString 输出、TutorTranscript 集成。
import { describe, expect, it } from "vitest";
import { afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import MathText, {
  normalizeModelText,
  renderSegments,
  splitMathSegments
} from "./MathText";
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

  it("prefers block delimiters so a single $ inside $$ stays math", () => {
    expect(splitMathSegments("$$a$b$$")).toEqual([
      { type: "math", content: "a$b", block: true }
    ]);
  });

  it("keeps interleaved block and inline math in original order", () => {
    expect(splitMathSegments("前 $$a$$ 中 $b$ 后")).toEqual([
      { type: "text", content: "前 " },
      { type: "math", content: "a", block: true },
      { type: "text", content: " 中 " },
      { type: "math", content: "b", block: false },
      { type: "text", content: " 后" }
    ]);
  });

  it("keeps a lone dollar inside a code fence as plain text", () => {
    expect(splitMathSegments("```js\nconst a = $5;\n```")).toEqual([
      { type: "text", content: "```js\nconst a = $5;\n```" }
    ]);
  });

  // 已知限制（MVP 接受，见 splitMathSegments 注释）：不做转义处理，同一文本里两个
  // $ 就按行内公式切，即使它们位于代码块或 \$ 转义中。下面两个用例钉住当前行为，
  // 若将来加转义/代码块感知，需翻转断言。
  it("pins the code-fence mis-split when a fence contains two dollars", () => {
    expect(splitMathSegments("```js\nconst a = $5;\nconst b = $6;\n```")).toEqual([
      { type: "text", content: "```js\nconst a = " },
      { type: "math", content: "5;\nconst b = ", block: false },
      { type: "text", content: "6;\n```" }
    ]);
  });

  it("pins the escaped-dollar mis-split (\\$ is not honored)", () => {
    expect(splitMathSegments("价格 \\$5 与 \\$6")).toEqual([
      { type: "text", content: "价格 \\" },
      { type: "math", content: "5 与 \\", block: false },
      { type: "text", content: "6" }
    ]);
  });
});

describe("normalizeModelText", () => {
  it("converts literal backslash-n into real newlines", () => {
    const raw = "第一题：下面代码的输出是？\\n\\nString s1 = \"hello\";";
    expect(normalizeModelText(raw)).toBe(
      "第一题：下面代码的输出是？\n\nString s1 = \"hello\";"
    );
  });

  it("leaves text without literal escapes untouched", () => {
    expect(normalizeModelText("plain text\nwith real newline")).toBe(
      "plain text\nwith real newline"
    );
  });
});

describe("MathText render integration", () => {
  it("renders a fenced code block in the question text", () => {
    const { container } = render(
      <MathText text={"看这段代码：\n\n```rust\nfn max_of<T: PartialOrd>(a: T, b: T) -> T {\n    if a > b { a } else { b }\n}\n```\n\n它做了什么？"} />
    );
    expect(container.querySelector("pre code")).not.toBeNull();
    expect(container.textContent).toContain("fn max_of<T: PartialOrd>");
  });

  it("normalizes literal backslash-n before rendering", () => {
    const { container } = render(
      <MathText text={"a\\nb\\nc"} />
    );
    expect(container.textContent).toContain("a");
    expect(container.textContent).toContain("b");
    expect(container.textContent).not.toContain("\\n");
  });

  it("breaks single newlines so bare code lines stay readable", () => {
    const { container } = render(
      <MathText text={"System.out.println(s1 == s2);\nSystem.out.println(s1 == s3);"} />
    );
    expect(container.querySelectorAll("br").length).toBeGreaterThan(0);
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

  it("does not throw on invalid LaTeX with throwOnError:false", () => {
    expect(() =>
      renderSegments([{ type: "math", content: "\\frac{", block: false }])
    ).not.toThrow();
    const html = renderSegments([
      { type: "math", content: "\\frac{", block: false }
    ]);
    expect(html).toContain("katex");
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

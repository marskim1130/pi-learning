// MathText（规格 20/26 推荐 KaTeX）：把文本按 $$...$$（块级）与 $...$（行内）切成
// 段，非公式段走 marked，公式段用 katex.renderToString。dangerouslySetInnerHTML 的
// XSS 策略沿用 TutorTranscript 注释（内容来自本地 Tutor 模型输出）。

import katex from "katex";
import { marked } from "marked";

import "katex/dist/katex.min.css";

/**
 * 归一化模型输出中的字面 "\\n"：部分模型在 JSON 参数里把换行写成双重转义
 * （\\n），JSON.parse 后仍是反斜杠+n 字面字符。学习场景中这几乎总是转义错误，
 * 统一还原为真换行（见验收时 Java 题目的 question 字段）。
 */
export function normalizeModelText(text: string): string {
  return text.replace(/\\n/g, "\n");
}

export type MathSegment =
  | { type: "text"; content: string }
  | { type: "math"; content: string; block: boolean };

/**
 * 按公式定界符切段，保持原顺序。先切 $$（块级，可跨行）再切 $（行内，宽松匹配），
 * 避免行内匹配吞掉块级定界符；转义字符处理不做（LLM 输出场景，极端混合输入可能
 * 错切，MVP 接受）。
 */
export function splitMathSegments(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let rest = text;
  while (rest.length > 0) {
    const block = matchDelimited(rest, "$$");
    const inline = matchDelimited(rest, "$");
    if (block !== null && (inline === null || block.index <= inline.index)) {
      pushText(segments, rest.slice(0, block.index));
      segments.push({ type: "math", content: block.content, block: true });
      rest = rest.slice(block.index + block.full.length);
    } else if (inline !== null) {
      pushText(segments, rest.slice(0, inline.index));
      segments.push({ type: "math", content: inline.content, block: false });
      rest = rest.slice(inline.index + inline.full.length);
    } else {
      pushText(segments, rest);
      rest = "";
    }
  }
  return segments;
}

function matchDelimited(
  text: string,
  delim: string
): { index: number; content: string; full: string } | null {
  const start = text.indexOf(delim);
  if (start === -1) {
    return null;
  }
  const end = text.indexOf(delim, start + delim.length);
  if (end === -1) {
    return null;
  }
  return {
    index: start,
    content: text.slice(start + delim.length, end),
    full: text.slice(start, end + delim.length)
  };
}

function pushText(segments: MathSegment[], content: string): void {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return;
  }
  const last = segments[segments.length - 1];
  if (last !== undefined && last.type === "text") {
    last.content = `${last.content}${content}`;
  } else {
    segments.push({ type: "text", content });
  }
}

/** 段列表 → HTML：text 段走 marked（保留 markdown，breaks 让单换行也断行），math 段走 KaTeX。 */
export function renderSegments(segments: MathSegment[]): string {
  return segments
    .map((segment) =>
      segment.type === "math"
        ? katex.renderToString(segment.content, {
            throwOnError: false,
            displayMode: segment.block
          })
        : marked.parse(segment.content, { async: false, breaks: true })
    )
    .join("");
}

export default function MathText({
  text,
  className
}: {
  text: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={className ?? "entry-text"}
      // XSS 风险：内容来自本地 Tutor 模型输出（学习场景），未消毒直接渲染。
      // 若未来引入外部/用户输入来源，先接 DOMPurify 再落 dangerouslySetInnerHTML。
      dangerouslySetInnerHTML={{
        __html: renderSegments(splitMathSegments(normalizeModelText(text)))
      }}
    />
  );
}

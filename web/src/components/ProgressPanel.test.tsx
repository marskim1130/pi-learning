// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useLearningWorkspace } from "../state/store";
import ProgressPanel from "./ProgressPanel";

afterEach(cleanup);

beforeEach(() => {
  useLearningWorkspace.setState({
    session: {
      learningMode: true,
      course: { id: "rust", title: "Rust" },
      topic: { id: "ownership", title: "Ownership" },
      phase: "practicing",
      concepts: [
        {
          id: "borrowing",
          title: "Borrowing",
          mastery: 0.28,
          attempts: 1,
          correct: 1,
          misconceptions: []
        }
      ]
    }
  });
});

describe("ProgressPanel", () => {
  it("renders normalized mastery values as percentages", () => {
    render(<ProgressPanel />);

    expect(screen.getByText("总体掌握度 28%")).toBeTruthy();
    expect(screen.getByText("28%", { selector: ".concept-mastery" })).toBeTruthy();

    const progressbar = screen.getByRole("progressbar", {
      name: "Borrowing 掌握度"
    });
    expect(progressbar.getAttribute("aria-valuenow")).toBe("28");
    expect(
      progressbar.querySelector<HTMLElement>(".bar-fill")?.style.width
    ).toBe("28%");
  });
});

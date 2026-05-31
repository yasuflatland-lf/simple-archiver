import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetJobStore, useJobStore } from "@/store/jobStore";
import { OverallProgress } from "./OverallProgress";

beforeEach(() => {
  resetJobStore();
});

describe("OverallProgress", () => {
  it("renders nothing when there is no progress", () => {
    const { container } = render(<OverallProgress />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the overall bar, percent, and ETA from the progress event", () => {
    useJobStore.setState({
      progress: {
        overall: { bytesDone: 50, bytesTotal: 200 },
        overallEtaMs: 83000,
        perTask: [],
        elapsedMs: 1000,
      },
    });

    render(<OverallProgress />);

    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByText(/25%/)).toBeTruthy();
    expect(screen.getByText(/1m 23s/)).toBeTruthy();
  });
});

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProgressEvent } from "@/bindings/ProgressEvent";
import type { TaskProgressDto } from "@/bindings/TaskProgressDto";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

// Import after mocks are registered.
import {
  addItems,
  cancelJob,
  PROGRESS_EVENT,
  previewOutputName,
  reorder,
  runJob,
  setNamingRule,
  setOutputDir,
  subscribeProgress,
} from "./archive";

describe("archive client", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(listen).mockReset();
  });

  describe("addItems", () => {
    it("invokes add_items with a paths array", async () => {
      vi.mocked(invoke).mockResolvedValue({
        items: [],
        namingTemplate: null,
        outputDir: null,
      });
      await addItems(["/a", "/b"]);
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("add_items", {
        paths: ["/a", "/b"],
      });
    });

    it("returns the DraftSnapshot from the backend", async () => {
      const snapshot = { items: [], namingTemplate: "x", outputDir: null };
      vi.mocked(invoke).mockResolvedValue(snapshot);
      const result = await addItems(["/a"]);
      expect(result).toEqual(snapshot);
    });
  });

  describe("reorder", () => {
    it("invokes reorder with from and to indices", async () => {
      vi.mocked(invoke).mockResolvedValue({
        items: [],
        namingTemplate: null,
        outputDir: null,
      });
      await reorder(0, 1);
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("reorder", {
        from: 0,
        to: 1,
      });
    });
  });

  describe("setNamingRule", () => {
    it("invokes set_naming_rule with the template string", async () => {
      vi.mocked(invoke).mockResolvedValue({
        items: [],
        namingTemplate: "img_{n}",
        outputDir: null,
      });
      await setNamingRule("img_{n}");
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("set_naming_rule", {
        template: "img_{n}",
      });
    });
  });

  describe("setOutputDir", () => {
    it("invokes set_output_dir with the dir string", async () => {
      vi.mocked(invoke).mockResolvedValue({
        items: [],
        namingTemplate: null,
        outputDir: "/out",
      });
      await setOutputDir("/out");
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("set_output_dir", {
        dir: "/out",
      });
    });
  });

  describe("runJob", () => {
    it("invokes run_job with no arguments", async () => {
      vi.mocked(invoke).mockResolvedValue({
        succeeded: [],
        cancelled: [],
        failed: [],
      });
      await runJob();
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("run_job");
    });

    it("returns the JobSummaryDto from the backend", async () => {
      const summary = { succeeded: [1, 2], cancelled: [], failed: [] };
      vi.mocked(invoke).mockResolvedValue(summary);
      const result = await runJob();
      expect(result).toEqual(summary);
    });
  });

  describe("cancelJob", () => {
    it("invokes cancel_job with no arguments", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);
      await cancelJob();
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("cancel_job");
    });
  });

  describe("previewOutputName", () => {
    it("invokes preview_output_name with template and seq", async () => {
      vi.mocked(invoke).mockResolvedValue("img_001.zip");
      await previewOutputName("img_{n:03}", 1);
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("preview_output_name", {
        template: "img_{n:03}",
        seq: 1,
      });
    });

    it("returns the resolved filename string from the backend", async () => {
      vi.mocked(invoke).mockResolvedValue("img_001.zip");
      const result = await previewOutputName("img_{n:03}", 1);
      expect(result).toBe("img_001.zip");
    });
  });

  describe("subscribeProgress", () => {
    it("calls listen with the correct channel name", async () => {
      const fakeListen = vi.fn().mockResolvedValue(() => {});
      vi.mocked(listen).mockImplementation(fakeListen);

      await subscribeProgress(() => {});
      expect(fakeListen).toHaveBeenCalledWith(
        "archive://progress",
        expect.any(Function),
      );
    });

    it("PROGRESS_EVENT constant matches the channel string", () => {
      expect(PROGRESS_EVENT).toBe("archive://progress");
    });

    it("forwards the event payload to the callback", async () => {
      // Capture the handler passed to listen so we can invoke it manually.
      let capturedHandler: ((e: { payload: ProgressEvent }) => void) | null =
        null;
      vi.mocked(listen).mockImplementation((_channel, handler) => {
        capturedHandler = handler as (e: { payload: ProgressEvent }) => void;
        return Promise.resolve(() => {});
      });

      const received: ProgressEvent[] = [];
      await subscribeProgress((ev) => received.push(ev));

      // Build a typed ProgressEvent literal with a non-empty perTask array —
      // acts as a compile-time check that camelCase field names match the
      // generated bindings, and proves per-task data is forwarded intact.
      const taskProgress: TaskProgressDto = {
        taskId: 1,
        bytesDone: 10,
        bytesTotal: 20,
        etaMs: null,
      };
      const payload: ProgressEvent = {
        overall: { bytesDone: 10, bytesTotal: 20 },
        perTask: [taskProgress],
        elapsedMs: 3,
        overallEtaMs: null,
      };

      expect(capturedHandler).not.toBeNull();
      const handler = capturedHandler as unknown as (e: {
        payload: ProgressEvent;
      }) => void;
      handler({ payload });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(payload);
    });

    it("returns the unlisten function provided by listen", async () => {
      const unlistenFn = () => {};
      const fakeListen = vi.fn().mockResolvedValue(unlistenFn);
      vi.mocked(listen).mockImplementation(fakeListen);

      const result = await subscribeProgress(() => {});
      expect(result).toBe(unlistenFn);
    });
  });
});

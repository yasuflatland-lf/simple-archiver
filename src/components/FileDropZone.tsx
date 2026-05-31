import { getCurrentWebview } from "@tauri-apps/api/webview";
import { type OpenDialogOptions, open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { messageFromReason } from "@/lib/errors";
import { useJobStore } from "@/store/jobStore";

/**
 * FileDropZone renders a drag-and-drop target area together with two browse
 * buttons ("Add files" and "Add folder"). OS-level drag events are wired via
 * the Tauri webview API; file/folder picking uses the Tauri dialog plugin.
 */
export function FileDropZone() {
  const [isDragging, setIsDragging] = useState(false);
  // Keep a ref so the async unlisten callback can fire even if the component
  // unmounts before the Promise resolves.
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Track whether the effect is still active; if the component unmounts
    // before the Promise resolves we still call unlisten via the ref.
    let mounted = true;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setIsDragging(true);
        } else if (payload.type === "leave") {
          setIsDragging(false);
        } else if (payload.type === "drop") {
          setIsDragging(false);
          // Mirror the browse handlers: skip addItems when the OS delivers an
          // empty paths array (can happen with certain drag sources).
          if (payload.paths.length > 0) {
            useJobStore.getState().addItems(payload.paths);
          }
        }
      })
      .then((unlisten) => {
        unlistenRef.current = unlisten;
        // If already unmounted by the time this resolves, clean up immediately.
        if (!mounted) {
          unlisten();
        }
      })
      .catch((reason) => {
        console.error("drag-drop subscription failed", reason);
      });

    return () => {
      mounted = false;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  // Shared logic for both browse buttons: open the picker, then add the
  // selected paths. open() rejects only on a real dialog/IPC failure;
  // cancellation resolves to null (handled by the Array.isArray guard).
  async function browseAndAdd(options: OpenDialogOptions) {
    try {
      const result = await open(options);
      if (Array.isArray(result) && result.length > 0) {
        useJobStore.getState().addItems(result as string[]);
      }
    } catch (reason) {
      useJobStore.setState({ error: messageFromReason(reason) });
    }
  }

  function handleAddFiles() {
    return browseAndAdd({
      multiple: true,
      directory: false,
      filters: [{ name: "rar", extensions: ["rar"] }],
    });
  }

  function handleAddFolder() {
    return browseAndAdd({ directory: true, multiple: true });
  }

  return (
    <div
      data-testid="drop-zone"
      className={[
        "flex flex-col items-center justify-center gap-4",
        "rounded border-2 border-dashed p-8 text-center",
        "transition-colors duration-150",
        isDragging
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground",
      ].join(" ")}
    >
      <p className="text-sm text-muted-foreground">
        Drag &amp; drop .rar files or folders here
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleAddFiles}>
          Add files
        </Button>
        <Button variant="outline" size="sm" onClick={handleAddFolder}>
          Add folder
        </Button>
      </div>
    </div>
  );
}

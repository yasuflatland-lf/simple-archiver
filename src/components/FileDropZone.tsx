import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
        const { type } = event.payload;
        if (type === "enter" || type === "over") {
          setIsDragging(true);
        } else if (type === "leave") {
          setIsDragging(false);
        } else if (type === "drop") {
          setIsDragging(false);
          const paths = (event.payload as { type: "drop"; paths: string[] })
            .paths;
          useJobStore.getState().addItems(paths);
        }
      })
      .then((unlisten) => {
        unlistenRef.current = unlisten;
        // If already unmounted by the time this resolves, clean up immediately.
        if (!mounted) {
          unlisten();
        }
      });

    return () => {
      mounted = false;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  async function handleAddFiles() {
    try {
      const result = await open({
        multiple: true,
        directory: false,
        filters: [{ name: "rar", extensions: ["rar"] }],
      });
      if (Array.isArray(result) && result.length > 0) {
        useJobStore.getState().addItems(result as string[]);
      }
    } catch {
      // Swallow errors — dialog errors or user cancellation should not crash.
    }
  }

  async function handleAddFolder() {
    try {
      const result = await open({
        directory: true,
        multiple: true,
      });
      if (Array.isArray(result) && result.length > 0) {
        useJobStore.getState().addItems(result as string[]);
      }
    } catch {
      // Swallow errors gracefully.
    }
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

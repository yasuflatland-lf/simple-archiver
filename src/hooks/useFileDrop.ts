import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";

import { messageFromReason } from "@/lib/errors";
import { useJobStore } from "@/store/jobStore";

/**
 * Subscribe ONCE to OS drag-drop over the whole webview. Returns whether a
 * drag is currently over the window; a drop adds its paths to the store (the OS
 * delivers both files and folders here uniformly — this is the only affordance
 * that accepts files and folders in a single drop gesture). Mount this exactly
 * once at the app root.
 */
export function useFileDrop(): { isDragging: boolean } {
  const [isDragging, setIsDragging] = useState(false);
  // Keep a ref so the async unlisten can fire even if we unmount before the
  // subscription promise resolves.
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
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
          // Skip addItems when the OS delivers an empty paths array (some drag
          // sources do this); otherwise add and surface any failure on the banner
          // rather than leaving an unhandled rejection.
          if (payload.paths && payload.paths.length > 0) {
            void useJobStore
              .getState()
              .addItems(payload.paths)
              .catch((reason) => {
                useJobStore.setState({ error: messageFromReason(reason) });
              });
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
        // Drag-and-drop is the primary affordance for adding sources; if the OS
        // channel fails to subscribe, tell the user to use the browse buttons
        // instead of silently no-opping every drop.
        console.error("drag-drop subscription failed", reason);
        useJobStore.setState({
          error:
            "Drag-and-drop is unavailable. Use Add files / Add folder instead.",
        });
      });

    return () => {
      mounted = false;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  return { isDragging };
}

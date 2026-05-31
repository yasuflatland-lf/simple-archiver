import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";

import { useJobStore } from "@/store/jobStore";

/**
 * Subscribe ONCE to OS drag-drop over the whole webview. Returns whether a
 * drag is currently over the window; a drop adds its paths to the store (the OS
 * delivers both files and folders here uniformly — this is the single
 * affordance that accepts both). Mount this exactly once at the app root.
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
          // Skip addItems when the OS delivers an empty paths array (can happen
          // with certain drag sources).
          if (payload.paths && payload.paths.length > 0) {
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
        // Drag-drop is an enhancement; log so a misconfigured channel is
        // debuggable without crashing the app.
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

  return { isDragging };
}

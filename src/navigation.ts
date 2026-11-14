// In-app navigation helpers shared by the router in App.tsx.
// - Leave guards: a page with unsaved changes registers one; go() / Link and the
//   browser back button ask before leaving, and closing or reloading the tab
//   gets the browser's own beforeunload prompt.
// - NAVIGATE_EVENT: fired after every in-app navigation, so a page that stays
//   mounted (same pathname) can react to a new ?query, e.g. /admin/chat?thread=.
import { useCallback, useEffect, useRef } from "react";
import { confirmDialog } from "./dialogs";

export const NAVIGATE_EVENT = "astra:navigate";
export const UNSAVED_MESSAGE = "มีการแก้ไขที่ยังไม่บันทึก ออกจากหน้านี้?";

type Guard = () => string | null;
const guards = new Set<Guard>();

/** True when no page blocks leaving, or the user confirmed leaving. */
export async function confirmLeave(): Promise<boolean> {
  for (const guard of guards) {
    const message = guard();
    if (message && !(await confirmDialog({ title: message, confirmText: "ออกจากหน้านี้" }))) return false;
  }
  return true;
}

/**
 * Ask before leaving while `dirty`. Returns `markClean()`: call it right before
 * navigating after a successful save, since state updates land after go().
 */
export function useUnsavedChangesGuard(dirty: boolean, message = UNSAVED_MESSAGE) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const guard: Guard = () => (dirtyRef.current ? message : null);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      e.returnValue = "";
    };
    guards.add(guard);
    addEventListener("beforeunload", beforeUnload);
    return () => {
      guards.delete(guard);
      removeEventListener("beforeunload", beforeUnload);
    };
  }, [message]);
  return useCallback(() => {
    dirtyRef.current = false;
  }, []);
}

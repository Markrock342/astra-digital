// Storefront bottom sheet. Based on shadcn/ui Sheet (side="bottom") + Drawer (MIT,
// https://ui.shadcn.com): dimmed overlay, panel sliding up from the bottom with a drag handle,
// title, close X, Esc / overlay click / drag-down to close, focus kept inside while open and
// returned to the trigger afterwards. Portalled to the top of .storefront-shell: it keeps the
// shop tokens, and no page wrapper (transitions, the sticky header) can trap or cover it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDialog } from "./dialog";
import { t } from "./i18n";
import "./sheet.css";

const EXIT_MS = 220;

export function BottomSheet({
  id,
  open,
  onClose,
  title,
  hideTitle = false,
  className = "",
  children,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  title: string;
  /** Title only for screen readers (the content has its own heading). */
  hideTitle?: boolean;
  className?: string;
  children: ReactNode;
}) {
  // Stay mounted for the slide-down after close. Opening mounts in the same render (not an
  // effect later), so Esc / focus work at once even when it is reopened mid-slide-down.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);
  useDialog(open, "#" + id, onClose);
  // No page scroll behind an open sheet.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  if (!mounted && !open) return null;
  const titleId = id + "-title";
  const host = document.querySelector(".storefront-shell") ?? document.body;
  return createPortal(
    <div className="sheet-root" data-state={open ? "open" : "closed"}>
      <div className="sheet-overlay" aria-hidden="true" onClick={onClose} />
      <div
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={"sheet-panel " + className}
        style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}
      >
        <div
          className="sheet-handle-area"
          aria-hidden="true"
          onPointerDown={(e) => {
            start.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (start.current !== null) setDrag(Math.max(0, e.clientY - start.current));
          }}
          onPointerUp={() => {
            const pulled = drag;
            start.current = null;
            setDrag(0);
            if (pulled > 80) onClose();
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrag(0);
          }}
        >
          <span className="sheet-handle" />
        </div>
        <div className="sheet-head">
          <h2 id={titleId} className={hideTitle ? "sr-only" : ""}>
            {title}
          </h2>
          <button type="button" className="sheet-close" aria-label={t("ปิด")} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    host,
  );
}

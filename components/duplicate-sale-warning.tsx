"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DUPLICATE_CONFIRM_LABEL,
  DUPLICATE_DELETE_LABEL,
  DUPLICATE_SALE_WARNING,
} from "@/lib/duplicate-sales";

export function DuplicateSaleWarning({
  onConfirm,
  onDelete,
  readOnly = false,
}: {
  onConfirm?: () => void;
  onDelete?: () => void;
  readOnly?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  function place() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({ top: rect.bottom + 8, left: Math.max(8, rect.left) });
  }

  function show() {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    place();
    setOpen(true);
  }

  function hide() {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setOpen(false), 160);
  }

  const popover =
    mounted && open
      ? createPortal(
          <div
            className="duplicate-sale-popover no-print"
            role="tooltip"
            style={{ top: coords.top, left: coords.left }}
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            <p>{DUPLICATE_SALE_WARNING}</p>
            {readOnly ? null : (
              <div className="duplicate-sale-popover-actions">
                {onConfirm ? (
                  <Button type="button" size="sm" onClick={onConfirm}>
                    {DUPLICATE_CONFIRM_LABEL}
                  </Button>
                ) : null}
                {onDelete ? (
                  <Button type="button" size="sm" variant="destructive" onClick={onDelete}>
                    {DUPLICATE_DELETE_LABEL}
                  </Button>
                ) : null}
              </div>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <span className="duplicate-sale-flag no-print">
      <button
        ref={triggerRef}
        type="button"
        className="duplicate-sale-trigger"
        aria-label={DUPLICATE_SALE_WARNING}
        aria-expanded={open}
        onMouseEnter={show}
        onFocus={show}
        onMouseLeave={hide}
        onBlur={hide}
      >
        <AlertTriangle aria-hidden="true" />
      </button>
      {popover}
    </span>
  );
}

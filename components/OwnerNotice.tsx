"use client";

/**
 * Shown once, on arrival after an upload: who can see this map, when it
 * goes away, and how to keep the right to delete it on another device.
 */
import { useState } from "react";
import { ownerLink } from "@/lib/workspace/ownerToken";
import { copyShareLink } from "@/lib/workspace/share";
import { CloseIcon } from "./Icons";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function OwnerNotice({ analysisId, expiresAt, ownerToken, onDismiss }: {
  analysisId: string; expiresAt: string | null; ownerToken: string; onDismiss: () => void;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const when = expiresAt ? `expires on ${DATE.format(new Date(expiresAt))}` : "is kept until you delete it";
  return (
    <aside className="owner-notice" role="status">
      <p>
        This map is public to anyone with its link and {when}. You can delete it from this browser.
      </p>
      <button
        type="button"
        className="button button-secondary"
        onClick={async () => setCopied((await copyShareLink(ownerLink(window.location.origin, analysisId, ownerToken))) ? "copied" : "failed")}
      >
        {copied === "copied" ? "Delete link copied" : copied === "failed" ? "Copy failed" : "Copy delete link"}
      </button>
      <button type="button" className="icon-button" aria-label="Dismiss" onClick={onDismiss}><CloseIcon size={12} /></button>
    </aside>
  );
}

import type { KeyboardEvent } from "react";

export function scrollWorkspaceTable(event: KeyboardEvent<HTMLDivElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
  event.preventDefault();
  event.currentTarget.scrollBy({ left: event.key === "ArrowRight" ? 120 : -120, behavior: "auto" });
}

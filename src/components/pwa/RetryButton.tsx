"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** Reloads the URL the offline page is standing in for. */
export function RetryButton() {
  return (
    <Button variant="secondary" icon={<RotateCw size={16} aria-hidden />} onClick={() => window.location.reload()}>
      Try again
    </Button>
  );
}

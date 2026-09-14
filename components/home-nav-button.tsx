"use client";

import Link from "next/link";
import { ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

type HomeNavButtonProps = {
  placement: "header" | "toolbar";
};

export function HomeNavButton({ placement }: HomeNavButtonProps) {
  if (placement === "toolbar") {
    return (
      <Button nativeButton={false} variant="outline" render={<Link href="/" />}>
        <ArrowLeft data-icon="inline-start" />
        Home
      </Button>
    );
  }

  return (
    <Button nativeButton={false} variant="outline" size="sm" render={<Link href="/" />}>
      <Home data-icon="inline-start" />
      Home
    </Button>
  );
}

"use client";

import { useState } from "react";
import { Download, Smartphone, X } from "lucide-react";
import { usePWAInstall } from "@/lib/use-pwa-install";
import { Button } from "@/components/ui/button";

export function PWAInstallButton({ className = "" }: { className?: string }) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void install()}
        className={`pwa-install-btn ${className}`}
        aria-label="Install app"
      >
        <Download className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
        Install App
      </Button>
    );
  }

  // iOS Safari flow (beforeinstallprompt is not supported by WebKit)
  if (isIOS) {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowIOSGuide(true)}
          className={`pwa-install-btn ${className}`}
          aria-label="Install on iPhone or iPad"
        >
          <Smartphone className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
          Install App
        </Button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl text-neutral-900 border border-neutral-200">
              <div className="flex items-center justify-between mb-3">
                <h3 id="ios-install-title" className="text-base font-bold text-emerald-900">
                  Install PayTracker on iPhone
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded text-neutral-500 hover:text-neutral-800"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-neutral-600 mb-4 leading-relaxed">
                Add <strong>Sales Pay Tracker</strong> to your home screen for quick standalone access and fullscreen worksheets:
              </p>
              <ol className="text-xs text-neutral-700 space-y-2 mb-5 list-decimal list-inside bg-neutral-50 p-3 rounded-lg border border-neutral-200">
                <li>
                  Tap the <strong>Share</strong> button (box with upward arrow) in Safari.
                </li>
                <li>
                  Scroll down the share sheet and tap <strong>Add to Home Screen</strong>.
                </li>
                <li>
                  Tap <strong>Add</strong> in the top right corner.
                </li>
              </ol>
              <Button
                type="button"
                className="w-full bg-emerald-800 hover:bg-emerald-700 text-white"
                onClick={() => setShowIOSGuide(false)}
              >
                Got It
              </Button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

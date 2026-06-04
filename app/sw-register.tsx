"use client";
import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // In development the service worker only causes grief: it serves stale
    // cached JS chunks while the dev server hands out fresh source, producing
    // impossible-looking errors. Unregister any existing SW and bail out.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister());
      });
      caches?.keys?.().then((keys) => keys.forEach((k) => caches.delete(k)));
      return;
    }

    // Whether this page was already controlled by a SW when it loaded. We only
    // want to auto-reload when an EXISTING worker is replaced by a new one
    // (a real deploy/update) — never on the very first install of the SW.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;

    const onControllerChange = () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      // A new SW took control after a deploy. Reload ONCE so the page's HTML
      // and lazily-loaded chunks all come from the same build — this is what
      // prevents the post-deploy ChunkLoadError crash loop.
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker.register("/sw.js").catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}

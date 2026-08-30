import { useEffect } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";

import {
  getSocket,
  emitStepChanged,
  onAdminNavigate,
  isAllowedRoute,
} from "@/services/socket";

/**
 * Wraps the existing router to:
 *  - initialize the socket connection once,
 *  - emit `session:step_changed` on route transitions,
 *  - listen for whitelisted `admin:navigate` commands and navigate internally.
 *
 * Mount once, near the app root. Does not alter UI.
 */
export function useSocketTracking(): void {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    getSocket();
  }, []);

  useEffect(() => {
    if (!pathname) return;
    emitStepChanged(pathname);
  }, [pathname]);

  useEffect(() => {
    const off = onAdminNavigate((path) => {
      if (!isAllowedRoute(path)) return;
      void router.navigate({ to: path as never });
    });
    return off;
  }, [router]);
}

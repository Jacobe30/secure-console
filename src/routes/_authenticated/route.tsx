import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getAuthState } from "@/lib/api-client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const state = await getAuthState().catch(() => null);
    if (!state?.user) throw redirect({ to: "/" });
    return { user: state.user };
  },
  component: () => <Outlet />,
});

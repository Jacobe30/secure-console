import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bootstrapAdmin, getAuthState, loginAdmin } from "@/lib/api-client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Tameeni Care Admin" },
      {
        name: "description",
        content: "Restricted operations sign-in for the quote review dashboard.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const [loadingState, setLoadingState] = useState(true);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    getAuthState()
      .then((state) => {
        if (state.user) {
          navigate({ to: "/admin", replace: true });
          return;
        }
        setBootstrapRequired(state.bootstrapRequired);
      })
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Unable to load sign-in."),
      )
      .finally(() => setLoadingState(false));
  }, [navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (bootstrapRequired) {
        await bootstrapAdmin({ email, password, displayName });
        toast.success("First administrator account created.");
      } else {
        await loginAdmin({ email, password });
        toast.success("Signed in successfully.");
      }
      navigate({ to: "/admin", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <CardTitle className="text-2xl">Tameeni Care Admin</CardTitle>
            <CardDescription className="mt-2">
              {loadingState
                ? "Checking administrator setup…"
                : bootstrapRequired
                  ? "Create the first administrator account for this empty database."
                  : "Sign in to review and manage quote requests."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loadingState ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              {bootstrapRequired && (
                <div className="space-y-2">
                  <Label htmlFor="display-name">Display name</Label>
                  <Input
                    id="display-name"
                    autoComplete="name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    minLength={1}
                    maxLength={120}
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength={254}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={bootstrapRequired ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={12}
                  maxLength={256}
                  required
                />
                {bootstrapRequired && (
                  <p className="text-xs text-muted-foreground">Use at least 12 characters.</p>
                )}
              </div>
              <Button className="w-full" type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {bootstrapRequired ? "Create first administrator" : "Sign in"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

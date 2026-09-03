import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  LogOut,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  currentStage,
  emitAdminRedirect,
  fetchSessionEvents,
  fetchSessions,
  getSocket,
  reviewSession,
  type SafeStateEvent,
  type SessionRecord,
} from "@/lib/backend";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin dashboard — Tameeni Care" },
      { name: "description", content: "Safe quote and provider-state review dashboard." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminDashboard,
});

type ReviewFilter = "pending" | "accepted" | "declined" | "all";

function AdminDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("pending");
  const [selected, setSelected] = useState<SessionRecord | null>(null);
  const [connected, setConnected] = useState(false);

  const sessionsQuery = useQuery({
    queryKey: ["safe-sessions"],
    queryFn: fetchSessions,
    refetchInterval: 5_000,
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const online = () => setConnected(true);
    const offline = () => setConnected(false);
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["safe-sessions"] });
    setConnected(socket.connected);
    socket.on("connect", online);
    socket.on("disconnect", offline);
    socket.on("session:state_changed", refresh);
    return () => {
      socket.off("connect", online);
      socket.off("disconnect", offline);
      socket.off("session:state_changed", refresh);
    };
  }, [queryClient]);

  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return sessions.filter((record) => {
      if (filter !== "all" && record.status !== filter) return false;
      if (!term) return true;
      return [
        record._id,
        record.customer_name,
        record.customer_phone,
        record.insurance_type,
        record.vehicle_make_model,
        record.payment_card_last4,
        record.payment_reference,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [filter, query, sessions]);

  const stats = useMemo(
    () => ({
      total: sessions.length,
      tokenization: sessions.filter((record) => record.payment_state === "tokenization_required")
        .length,
      verification: sessions.filter(
        (record) => record.verification_state === "pending_provider_verification",
      ).length,
      confirmed: sessions.filter(
        (record) =>
          record.status === "accepted" ||
          record.payment_state === "tokenized" ||
          record.verification_state === "verified",
      ).length,
    }),
    [sessions],
  );

  const signOut = async () => {
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Safe Operations Dashboard</h1>
              <p className="text-xs text-muted-foreground">Quote and provider-state review</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={connected ? "default" : "secondary"} className="hidden gap-1 sm:flex">
              {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {connected ? "Marker stream connected" : "Polling safely"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sessionsQuery.refetch()}
              disabled={sessionsQuery.isFetching}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${sessionsQuery.isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Total requests"
            value={stats.total}
            icon={<Activity className="h-4 w-4" />}
          />
          <Stat
            label="Tokenization required"
            value={stats.tokenization}
            icon={<CreditCard className="h-4 w-4 text-amber-600" />}
          />
          <Stat
            label="Provider verification"
            value={stats.verification}
            icon={<Clock3 className="h-4 w-4 text-amber-600" />}
          />
          <Stat
            label="Confirmed"
            value={stats.confirmed}
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          />
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle>Quote requests</CardTitle>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search customer, request, or last four"
                className="pl-9"
              />
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={filter} onValueChange={(value) => setFilter(value as ReviewFilter)}>
              <TabsList className="grid w-full grid-cols-4 sm:w-auto">
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="accepted">Accepted</TabsTrigger>
                <TabsTrigger value="declined">Declined</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
              <TabsContent value={filter} className="mt-4">
                {sessionsQuery.isLoading ? (
                  <div className="py-16 text-center text-sm text-muted-foreground">
                    Loading requests…
                  </div>
                ) : sessionsQuery.isError ? (
                  <div className="py-16 text-center text-sm text-destructive">
                    {sessionsQuery.error instanceof Error
                      ? sessionsQuery.error.message
                      : "Requests could not be loaded."}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="py-16 text-center text-sm text-muted-foreground">
                    No requests match this view.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Customer</TableHead>
                          <TableHead>Quote</TableHead>
                          <TableHead>Payment confirmation</TableHead>
                          <TableHead>Provider state</TableHead>
                          <TableHead>Updated</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((record) => {
                          const stage = currentStage(record);
                          return (
                            <TableRow key={record._id}>
                              <TableCell>
                                <div className="font-medium">
                                  {record.customer_name ?? "Unnamed"}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {record.customer_phone ?? record._id.slice(0, 8)}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="text-sm">
                                  {record.insurance_type ?? "General quote"}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {[record.vehicle_year, record.vehicle_make_model]
                                    .filter(Boolean)
                                    .join(" ") || "—"}
                                </div>
                              </TableCell>
                              <TableCell>
                                <MaskedPayment record={record} />
                              </TableCell>
                              <TableCell>
                                <StageBadge {...stage} />
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                {formatWhen(record.last_activity_at ?? record.created_at)}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSelected(record)}
                                >
                                  Review <ChevronRight className="ml-1 h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>

      <SafeReviewDialog
        record={selected}
        onClose={() => setSelected(null)}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ["safe-sessions"] })}
      />
    </div>
  );
}

function SafeReviewDialog({
  record,
  onClose,
  onChanged,
}: {
  record: SessionRecord | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"accepted" | "declined" | null>(null);
  const eventsQuery = useQuery({
    queryKey: ["safe-events", record?._id],
    queryFn: () => fetchSessionEvents(record?._id ?? ""),
    enabled: Boolean(record),
  });

  useEffect(() => setNote(record?.review_note ?? ""), [record]);
  if (!record) return null;

  const decide = async (status: "accepted" | "declined") => {
    setBusy(status);
    try {
      await reviewSession(record._id, status, note);
      toast.success(status === "accepted" ? "Request accepted." : "Request declined.");
      onChanged();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Review could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  const redirect = (path: string) => {
    if (!emitAdminRedirect(record._id, path)) {
      toast.error("That route is not allowlisted.");
      return;
    }
    toast.success(`Safe navigation marker sent to ${path}.`);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{record.customer_name ?? "Quote request"}</DialogTitle>
          <DialogDescription>
            Request <span className="font-mono">{record._id}</span>. Only masked metadata and status
            markers are available.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Quote information</h3>
            <Field label="Phone" value={record.customer_phone} />
            <Field label="Insurance" value={record.insurance_type} />
            <Field label="Vehicle" value={record.vehicle_make_model} />
            <Field label="Year" value={record.vehicle_year?.toString()} />
            <Field label="Value" value={record.vehicle_value?.toString()} />
            <Field label="Policy start" value={record.policy_start_date} />
            <Field label="Repair" value={record.repair_location} />
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Safe confirmation</h3>
            <Field label="Payment method" value={maskedCard(record)} mono />
            <Field label="Payment state" value={labelize(record.payment_state)} />
            <Field label="Verification" value={labelize(record.verification_state)} />
            <Field label="Last event" value={labelize(record.last_event_type)} />
            <Field label="Provider reference" value={record.payment_reference} mono />
          </section>
        </div>

        <section className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold">Marker history</h3>
          <MarkerHistory events={eventsQuery.data ?? []} loading={eventsQuery.isLoading} />
        </section>

        <section className="space-y-2 border-t pt-4">
          <Label htmlFor="review-note">Internal note</Label>
          <Textarea
            id="review-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={300}
            placeholder="Operational note; never paste payment or verification credentials"
          />
        </section>

        <section className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">Safe navigation</h3>
          <div className="flex flex-wrap gap-2">
            {["/", "/reg", "/activate", "/activate_shamel", "/confirm", "/phone"].map((path) => (
              <Button key={path} size="sm" variant="outline" onClick={() => redirect(path)}>
                <Send className="mr-1 h-3.5 w-3.5" /> {path}
              </Button>
            ))}
          </div>
        </section>

        <DialogFooter className="gap-2 border-t pt-4 sm:justify-between">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => decide("declined")}
              disabled={busy !== null}
            >
              <XCircle className="mr-2 h-4 w-4" /> Decline
            </Button>
            <Button onClick={() => decide("accepted")} disabled={busy !== null}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Accept
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarkerHistory({ events, loading }: { events: SafeStateEvent[]; loading: boolean }) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading markers…</p>;
  if (!events.length) return <p className="text-sm text-muted-foreground">No markers recorded.</p>;
  return (
    <div className="max-h-48 space-y-2 overflow-y-auto">
      {events.map((event, index) => (
        <div
          key={`${event.occurredAt}-${index}`}
          className="flex items-center justify-between rounded-md border p-2 text-sm"
        >
          <div>
            <div className="font-medium">{labelize(event.eventType)}</div>
            <div className="text-xs text-muted-foreground">
              {labelize(event.state)}
              {event.cardLast4 ? ` · •••• ${event.cardLast4}` : ""}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">{formatWhen(event.occurredAt)}</div>
        </div>
      ))}
    </div>
  );
}

function MaskedPayment({ record }: { record: SessionRecord }) {
  return (
    <div>
      <div className="font-mono text-sm">{maskedCard(record)}</div>
      <div className="text-xs text-muted-foreground">{labelize(record.payment_state)}</div>
    </div>
  );
}

function maskedCard(record: SessionRecord) {
  const brand = record.payment_card_brand ? labelize(record.payment_card_brand) : "Card";
  return record.payment_card_last4
    ? `${brand} •••• ${record.payment_card_last4}`
    : `${brand} · no card data stored`;
}

function StageBadge({
  label,
  tone,
}: {
  label: string;
  tone: "green" | "red" | "yellow" | "muted";
}) {
  const className =
    tone === "green"
      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700"
      : tone === "red"
        ? "border-red-500/30 bg-red-500/15 text-red-700"
        : tone === "yellow"
          ? "border-amber-500/40 bg-amber-500/15 text-amber-700"
          : "border-border bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        </div>
        <div className="rounded-md bg-muted p-2">{icon}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`col-span-2 break-all ${mono ? "font-mono" : ""}`}>
        {value || <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function labelize(value?: string | null) {
  if (!value) return "—";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatWhen(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  CreditCard,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { currentStage, fetchSessions, reviewSession, type SessionRecord } from "@/lib/backend";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/sessions")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Safe State Monitor — Tameeni Care" },
      { name: "description", content: "Realtime marker monitoring without payment or OTP data." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SessionsDashboard,
});

type StatusFilter = "all" | "pending" | "accepted" | "declined";

function SessionsDashboard() {
  const [rows, setRows] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await fetchSessions());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Safe states could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel("safe-quote-markers")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "starter_quote_requests" },
        () => {
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(load, 150);
        },
      )
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((record) => {
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
  }, [filter, query, rows]);

  const stats = useMemo(
    () => ({
      total: rows.length,
      paymentMarkers: rows.filter((record) => Boolean(record.payment_state)).length,
      providerPending: rows.filter(
        (record) => record.verification_state === "pending_provider_verification",
      ).length,
      confirmed: rows.filter(
        (record) =>
          record.status === "accepted" ||
          record.payment_state === "tokenized" ||
          record.verification_state === "verified",
      ).length,
    }),
    [rows],
  );

  const decide = async (record: SessionRecord, status: "accepted" | "declined") => {
    setBusyId(record._id);
    try {
      await reviewSession(record._id, status);
      toast.success(status === "accepted" ? "Request accepted." : "Request declined.");
      await load();
    } catch (decisionError) {
      toast.error(decisionError instanceof Error ? decisionError.message : "Update failed.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen space-y-6 bg-background p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Safe State Monitor</h1>
          <p className="text-sm text-muted-foreground">
            Realtime confirmation markers only. Payment credentials and OTPs are never displayed.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={<Activity className="h-5 w-5" />} label="Requests" value={stats.total} />
        <StatCard
          icon={<CreditCard className="h-5 w-5 text-blue-600" />}
          label="Payment markers"
          value={stats.paymentMarkers}
        />
        <StatCard
          icon={<ShieldCheck className="h-5 w-5 text-amber-600" />}
          label="Provider pending"
          value={stats.providerPending}
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          label="Confirmed"
          value={stats.confirmed}
        />
      </section>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle>Marker stream</CardTitle>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search safe metadata"
                className="w-64 pl-8"
              />
            </div>
            <Select value={filter} onValueChange={(value) => setFilter(value as StatusFilter)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {error && (
            <div className="mb-3 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Quote</TableHead>
                <TableHead>Masked payment</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No safe marker records
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((record) => {
                const stage = currentStage(record);
                return (
                  <TableRow key={record._id}>
                    <TableCell>
                      <div className="font-mono text-xs">{record._id.slice(0, 8)}…</div>
                      <div className="text-xs text-muted-foreground">
                        {formatWhen(record.last_activity_at ?? record.created_at)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{record.customer_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {record.customer_phone ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{record.insurance_type ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {[record.vehicle_year, record.vehicle_make_model]
                          .filter(Boolean)
                          .join(" ") || "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{maskedPayment(record)}</div>
                      <div className="text-xs text-muted-foreground">
                        {labelize(record.payment_state)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={toneClass(stage.tone)}>
                        {stage.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === record._id}
                          onClick={() => decide(record, "accepted")}
                        >
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-emerald-600" /> Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === record._id}
                          onClick={() => decide(record, "declined")}
                        >
                          <XCircle className="mr-1 h-3.5 w-3.5 text-red-600" /> Decline
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-muted p-2">{icon}</div>
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function maskedPayment(record: SessionRecord) {
  const brand = record.payment_card_brand ? labelize(record.payment_card_brand) : "Card";
  return record.payment_card_last4
    ? `${brand} •••• ${record.payment_card_last4}`
    : `${brand} · not stored`;
}

function labelize(value?: string | null) {
  if (!value) return "—";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toneClass(tone: "green" | "red" | "yellow" | "muted") {
  if (tone === "green") return "border-emerald-500/30 bg-emerald-500/15 text-emerald-700";
  if (tone === "red") return "border-red-500/30 bg-red-500/15 text-red-700";
  if (tone === "yellow") return "border-amber-500/40 bg-amber-500/15 text-amber-700";
  return "border-border bg-muted text-muted-foreground";
}

function formatWhen(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

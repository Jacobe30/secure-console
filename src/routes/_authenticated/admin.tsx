import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  getQuoteActivity,
  listQuoteRequests,
  logoutAdmin,
  reviewQuoteRequest,
  type QuoteRequest,
  type QuoteStatus,
} from "@/lib/api-client";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Quote review — Tameeni Care Admin" },
      { name: "description", content: "Review and manage customer quote requests." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminDashboard,
});

type StatusFilter = QuoteStatus | "all";

function AdminDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<QuoteRequest | null>(null);

  const requestsQuery = useQuery({
    queryKey: ["quote-requests", status, search],
    queryFn: () => listQuoteRequests({ status, query: search }),
    refetchInterval: 15_000,
  });

  const signOut = async () => {
    await logoutAdmin().catch(() => undefined);
    queryClient.clear();
    navigate({ to: "/", replace: true });
  };

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };

  const requests = requestsQuery.data?.requests ?? [];
  const total = requestsQuery.data?.total ?? 0;

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-lg font-semibold">Quote Review Dashboard</h1>
            <p className="text-sm text-muted-foreground">Tameeni Care operations</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => requestsQuery.refetch()}
              disabled={requestsQuery.isFetching}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${requestsQuery.isFetching ? "animate-spin" : ""}`}
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
        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryCard icon={<FileText className="h-5 w-5" />} label="Current view" value={total} />
          <SummaryCard
            icon={<Clock3 className="h-5 w-5 text-amber-600" />}
            label="Filter"
            text={status === "all" ? "All requests" : capitalize(status)}
          />
          <SummaryCard
            icon={<Activity className="h-5 w-5 text-emerald-600" />}
            label="Auto refresh"
            text="Every 15 seconds"
          />
        </div>

        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <CardTitle>Quote requests</CardTitle>
              <form onSubmit={applySearch} className="flex w-full max-w-md gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Search name or email"
                    className="pl-9"
                    maxLength={100}
                  />
                </div>
                <Button type="submit" variant="secondary">
                  Search
                </Button>
              </form>
            </div>
            <Tabs value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
              <TabsList className="grid w-full grid-cols-4 sm:w-auto">
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="accepted">Accepted</TabsTrigger>
                <TabsTrigger value="declined">Declined</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {requestsQuery.isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading requests
              </div>
            ) : requestsQuery.isError ? (
              <div className="py-16 text-center text-sm text-destructive">
                {requestsQuery.error instanceof Error
                  ? requestsQuery.error.message
                  : "Quote requests could not be loaded."}
              </div>
            ) : requests.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                No requests match this view.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Request</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell>
                          <div className="font-medium">{request.customerName}</div>
                          <div className="text-xs text-muted-foreground">
                            {request.customerEmail}
                          </div>
                          {request.customerPhone && (
                            <div className="text-xs text-muted-foreground">
                              {request.customerPhone}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{request.insuranceType ?? "General quote"}</div>
                          <div className="text-xs text-muted-foreground">
                            {[request.vehicleYear, request.vehicleMakeModel]
                              .filter(Boolean)
                              .join(" ") || "No vehicle details"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={request.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDate(request.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => setSelected(request)}>
                            Review
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <ReviewDialog
        request={selected}
        onClose={() => setSelected(null)}
        onReviewed={(updated) => {
          setSelected(updated);
          queryClient.invalidateQueries({ queryKey: ["quote-requests"] });
        }}
      />
    </div>
  );
}

function ReviewDialog({
  request,
  onClose,
  onReviewed,
}: {
  request: QuoteRequest | null;
  onClose: () => void;
  onReviewed: (request: QuoteRequest) => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<"accepted" | "declined" | null>(null);

  useEffect(() => {
    setNote(request?.internalNote ?? "");
  }, [request]);

  const activityQuery = useQuery({
    queryKey: ["quote-activity", request?.id],
    queryFn: () => getQuoteActivity(request?.id ?? ""),
    enabled: Boolean(request),
  });

  if (!request) return null;

  const review = async (status: "accepted" | "declined") => {
    setSaving(status);
    try {
      const result = await reviewQuoteRequest(request.id, {
        status,
        ...(note.trim() ? { internalNote: note.trim() } : {}),
      });
      toast.success(status === "accepted" ? "Quote request accepted." : "Quote request declined.");
      onReviewed(result.request);
      activityQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Review could not be saved.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {request.customerName} <StatusBadge status={request.status} />
          </DialogTitle>
          <DialogDescription>
            Submitted {formatDate(request.createdAt)} · Request {request.id.slice(0, 8)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Customer and quote</h3>
            <Detail label="Email" value={request.customerEmail} />
            <Detail label="Phone" value={request.customerPhone} />
            <Detail label="Insurance" value={request.insuranceType} />
            <Detail label="Vehicle year" value={request.vehicleYear?.toString()} />
            <Detail label="Vehicle" value={request.vehicleMakeModel} />
            <Detail label="Declared value" value={request.vehicleValue} />
            <Detail label="Use" value={request.usagePurpose} />
            <Detail label="Policy start" value={request.policyStartDate} />
            <Detail label="Repair location" value={request.repairLocation} />
            {request.selectedOffer && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                  Selected offer
                </div>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(request.selectedOffer, null, 2)}
                </pre>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Activity</h3>
            {activityQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading activity…</div>
            ) : activityQuery.isError ? (
              <div className="text-sm text-destructive">Activity could not be loaded.</div>
            ) : (activityQuery.data?.activity.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground">No activity recorded.</div>
            ) : (
              <div className="max-h-64 space-y-3 overflow-y-auto pr-2">
                {activityQuery.data?.activity.map((item) => (
                  <div key={item.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm font-medium">{activityLabel(item.action)}</div>
                      <div className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(item.createdAt)}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.admin?.displayName ?? item.admin?.email ?? capitalize(item.actorType)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-2 border-t pt-4">
          <Label htmlFor="internal-note">Internal note</Label>
          <Textarea
            id="internal-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note visible only to administrators"
            maxLength={2000}
            rows={4}
          />
          <div className="text-right text-xs text-muted-foreground">{note.length}/2000</div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => review("declined")}
              disabled={saving !== null}
            >
              {saving === "declined" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-2 h-4 w-4" />
              )}
              Decline
            </Button>
            <Button onClick={() => review("accepted")} disabled={saving !== null}>
              {saving === "accepted" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Accept
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  text,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  text?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-semibold">{value ?? text}</p>
        </div>
        <div className="rounded-md bg-muted p-2">{icon}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: QuoteStatus }) {
  if (status === "accepted") return <Badge className="bg-emerald-600">Accepted</Badge>;
  if (status === "declined") return <Badge variant="destructive">Declined</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid grid-cols-3 gap-3 text-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="col-span-2 break-words">
        {value || <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function activityLabel(value: string) {
  return value.split(".").map(capitalize).join(" ");
}

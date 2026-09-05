import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { format, subDays, eachDayOfInterval, parseISO, startOfDay } from "date-fns";
import { TrendingUp, Users, Calendar, Sparkles, Activity, CheckCircle2, AlertTriangle, Clock3, Percent, Briefcase, UserCheck, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { heroTitle } from "@/lib/motion";

interface AnalyticsLeadRow {
  id: string;
  created_at: string;
  status: string;
  service_type: string;
  number_name: string | null;
  assigned_cs: string | null;
}


const Analytics = () => {
  const [dateFilter, setDateFilter] = useState<"7d" | "30d" | "90d" | "all" | "custom">("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  // Fetch full details of all leads (operational fields only)
  const { data: allLeads = [] } = useQuery<AnalyticsLeadRow[]>({
    queryKey: ["analytics-total-operational"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, status, created_at, service_type, number_name, assigned_cs");
      if (error) throw error;
      return (data ?? []) as AnalyticsLeadRow[];
    },
  });

  // Fetch profiles list to map CS Agent UUIDs to names
  const { data: profiles = [] } = useQuery({
    queryKey: ["analytics-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles_public" as never)
        .select("id, full_name");
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string | null }[];
    },
  });

  // Create a fast map lookup for profiles
  const profileMap = useMemo(() => {
    return new Map(profiles.map((p) => [p.id, p.full_name]));
  }, [profiles]);

  // Calculate current range start/end timestamps
  const filteredRange = useMemo(() => {
    let startMs = 0;
    let endMs = Date.now();

    if (dateFilter === "7d") {
      startMs = subDays(new Date(), 7).getTime();
    } else if (dateFilter === "30d") {
      startMs = subDays(new Date(), 30).getTime();
    } else if (dateFilter === "90d") {
      startMs = subDays(new Date(), 90).getTime();
    } else if (dateFilter === "custom") {
      if (customStart) {
        const start = new Date(customStart);
        start.setHours(0, 0, 0, 0);
        startMs = start.getTime();
      }
      if (customEnd) {
        const end = new Date(customEnd);
        end.setHours(23, 59, 59, 999);
        endMs = end.getTime();
      }
    } else {
      startMs = 0;
    }

    return { startMs, endMs };
  }, [dateFilter, customStart, customEnd]);

  // Calculate previous range of equal length
  const prevRange = useMemo(() => {
    let startMs = 0;
    let endMs = 0;
    let durationMs = 0;

    if (dateFilter === "7d") {
      durationMs = 7 * 24 * 60 * 60 * 1000;
      endMs = subDays(new Date(), 7).getTime();
      startMs = endMs - durationMs;
    } else if (dateFilter === "30d") {
      durationMs = 30 * 24 * 60 * 60 * 1000;
      endMs = subDays(new Date(), 30).getTime();
      startMs = endMs - durationMs;
    } else if (dateFilter === "90d") {
      durationMs = 90 * 24 * 60 * 60 * 1000;
      endMs = subDays(new Date(), 90).getTime();
      startMs = endMs - durationMs;
    } else if (dateFilter === "custom") {
      const s = customStart ? new Date(customStart).getTime() : 0;
      const e = customEnd ? new Date(customEnd).getTime() : Date.now();
      durationMs = e - s;
      endMs = s;
      startMs = s - durationMs;
    }

    return { startMs, endMs };
  }, [dateFilter, customStart, customEnd]);

  // Filter leads for the selected range
  const leads = useMemo(() => {
    const { startMs, endMs } = filteredRange;
    return allLeads.filter((lead) => {
      const leadTime = new Date(lead.created_at).getTime();
      return leadTime >= startMs && leadTime <= endMs;
    });
  }, [allLeads, filteredRange]);

  // Filter leads for the previous range
  const prevLeads = useMemo(() => {
    if (dateFilter === "all") return [];
    const { startMs, endMs } = prevRange;
    return allLeads.filter((lead) => {
      const leadTime = new Date(lead.created_at).getTime();
      return leadTime >= startMs && leadTime <= endMs;
    });
  }, [allLeads, prevRange, dateFilter]);

  // Calculate dynamic start/end dates for the chart interval
  const chartInterval = useMemo(() => {
    let start = subDays(new Date(), 30);
    let end = new Date();

    if (dateFilter === "7d") {
      start = subDays(new Date(), 7);
    } else if (dateFilter === "30d") {
      start = subDays(new Date(), 30);
    } else if (dateFilter === "90d") {
      start = subDays(new Date(), 90);
    } else if (dateFilter === "custom") {
      if (customStart) start = new Date(customStart);
      if (customEnd) end = new Date(customEnd);
    } else {
      if (allLeads.length > 0) {
        const times = allLeads.map((l) => new Date(l.created_at).getTime());
        const minTime = Math.min(...times);
        const maxAgo = subDays(new Date(), 120).getTime();
        start = new Date(Math.max(minTime, maxAgo));
      } else {
        start = subDays(new Date(), 30);
      }
    }

    return { start, end };
  }, [dateFilter, customStart, customEnd, allLeads]);

  // Generate Date interval steps
  const days = useMemo(() => {
    return eachDayOfInterval({
      start: startOfDay(chartInterval.start),
      end: startOfDay(chartInterval.end),
    });
  }, [chartInterval]);

  // Daily leads intake chart data
  const chartData = useMemo(() => {
    const countsByDate = new Map<string, number>();

    for (const lead of leads) {
      const dateKey = lead.created_at.slice(0, 10);
      countsByDate.set(dateKey, (countsByDate.get(dateKey) ?? 0) + 1);
    }

    return days.map((day) => {
      const dateStr = format(day, "yyyy-MM-dd");
      return {
        date: format(day, "MMM d"),
        count: countsByDate.get(dateStr) ?? 0,
      };
    });
  }, [days, leads]);

  // Calculate current range summaries
  const currentStats = useMemo(() => {
    const totalLeads = leads.length;
    const scheduled = leads.filter(l => ["scheduled", "need_tech", "tech_making_quote"].includes(l.status)).length;
    const completed = leads.filter(l => ["job_done", "paid", "partial_paid"].includes(l.status)).length;
    const conversionRate = totalLeads > 0 ? (completed / totalLeads) * 100 : 0;

    return { totalLeads, scheduled, completed, conversionRate };
  }, [leads]);

  // Calculate previous range summaries (for delta metrics)
  const prevStats = useMemo(() => {
    const totalLeads = prevLeads.length;
    const scheduled = prevLeads.filter(l => ["scheduled", "need_tech", "tech_making_quote"].includes(l.status)).length;
    const completed = prevLeads.filter(l => ["job_done", "paid", "partial_paid"].includes(l.status)).length;
    const conversionRate = totalLeads > 0 ? (completed / totalLeads) * 100 : 0;

    return { totalLeads, scheduled, completed, conversionRate };
  }, [prevLeads]);

  // Calculate funnel progression stages
  const funnelData = useMemo(() => {
    const total = leads.length;
    const engaged = leads.filter(l => !["needs_quote", "waiting_complete_details"].includes(l.status)).length;
    const scheduled = leads.filter(l => ["scheduled", "job_in_progress", "job_done", "paid", "partial_paid"].includes(l.status)).length;
    const completed = leads.filter(l => ["job_done", "paid", "partial_paid"].includes(l.status)).length;

    return [
      { step: "Captured", count: total, pct: 100, color: "bg-blue-500" },
      { step: "Details Acquired", count: engaged, pct: total > 0 ? Math.round((engaged / total) * 100) : 0, color: "bg-purple-500" },
      { step: "Visits Scheduled", count: scheduled, pct: total > 0 ? Math.round((scheduled / total) * 100) : 0, color: "bg-indigo-500" },
      { step: "Jobs Completed", count: completed, pct: total > 0 ? Math.round((completed / total) * 100) : 0, color: "bg-emerald-500" },
    ];
  }, [leads]);

  // Lead aging distribution for active leads
  const agingData = useMemo(() => {
    const active = leads.filter(l => !["job_done", "paid", "cancelled"].includes(l.status));
    let under24h = 0;
    let oneToThreeDays = 0;
    let fourToSevenDays = 0;
    let eightPlusDays = 0;

    const now = Date.now();
    for (const lead of active) {
      const ageMs = now - new Date(lead.created_at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < 1) under24h += 1;
      else if (ageDays <= 3) oneToThreeDays += 1;
      else if (ageDays <= 7) fourToSevenDays += 1;
      else eightPlusDays += 1;
    }

    return [
      { name: "< 24 Hrs", count: under24h, fill: "hsl(217, 91%, 60%)" },
      { name: "1 - 3 Days", count: oneToThreeDays, fill: "hsl(142, 72%, 50%)" },
      { name: "4 - 7 Days", count: fourToSevenDays, fill: "hsl(38, 92%, 50%)" },
      { name: "8+ Days", count: eightPlusDays, fill: "hsl(0, 84%, 60%)" },
    ];
  }, [leads]);

  // CS Agent Performance (Assignments count)
  const agentPerformance = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of leads) {
      const name = lead.assigned_cs ? (profileMap.get(lead.assigned_cs) ?? "Unassigned / Bot") : "Unassigned / Bot";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [leads, profileMap]);

  // Calculate stats for all-time totals
  const summary = useMemo(() => {
    const todayStart = startOfDay(new Date());
    const weekAgo = subDays(new Date(), 7);
    const counts = {
      urgent: 0,
      scheduled: 0,
      done: 0,
      cancelled: 0,
      waiting: 0,
      today: 0,
      thisWeek: 0,
    };

    for (const lead of allLeads) {
      const createdAt = new Date(lead.created_at);

      if (createdAt >= weekAgo) counts.thisWeek += 1;
      if (createdAt >= todayStart) counts.today += 1;
      if (lead.status === "urgent_job") counts.urgent += 1;
      if (lead.status === "scheduled") counts.scheduled += 1;
      if (lead.status === "job_done" || lead.status === "paid") counts.done += 1;
      if (lead.status === "cancelled") counts.cancelled += 1;
      if (
        [
          "waiting_customer_response",
          "waiting_complete_details",
          "quote_sent_waiting",
          "quote_sent_need_follow_up",
          "needs_quote",
          "needs_reschedule",
        ].includes(lead.status)
      ) {
        counts.waiting += 1;
      }
    }

    return counts;
  }, [allLeads]);

  // Service Type Breakdown by lead volume
  const serviceDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of leads) {
      const type = lead.service_type?.trim() || "General / Unknown";
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // top 5
  }, [leads]);

  // Lead Phone Source Breakdown by lead volume
  const sourceDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of leads) {
      const source = lead.number_name?.trim() || "Web / Scraper";
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [leads]);

  const getGrowth = (current: number, prev: number) => {
    if (prev === 0) return current > 0 ? 100 : 0;
    const delta = ((current - prev) / prev) * 100;
    return Math.round(delta);
  };

  const formatDelta = (growth: number) => {
    if (growth > 0) return `+${growth}%`;
    if (growth < 0) return `${growth}%`;
    return "0%";
  };

  const stats = [
    {
      label: "Total Leads",
      value: currentStats.totalLeads,
      sub: `${formatDelta(getGrowth(currentStats.totalLeads, prevStats.totalLeads))} vs last period`,
      icon: Users,
      tone: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    },
    {
      label: "Scheduled Visits",
      value: currentStats.scheduled,
      sub: `${formatDelta(getGrowth(currentStats.scheduled, prevStats.scheduled))} vs last period`,
      icon: Calendar,
      tone: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    },
    {
      label: "Completed Jobs",
      value: currentStats.completed,
      sub: `${formatDelta(getGrowth(currentStats.completed, prevStats.completed))} vs last period`,
      icon: CheckCircle2,
      tone: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    },
    {
      label: "Conversion Rate",
      value: `${currentStats.conversionRate.toFixed(1)}%`,
      sub: `${formatDelta(getGrowth(currentStats.conversionRate, prevStats.conversionRate))} vs last period`,
      icon: Percent,
      tone: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    },
  ];

  const statusSummary = [
    {
      label: "Urgent Attention",
      value: summary.urgent,
      icon: AlertTriangle,
      tone: "bg-red-500/10 text-red-400 border-red-500/20",
    },
    {
      label: "Scheduled Visits",
      value: summary.scheduled,
      icon: Calendar,
      tone: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    },
    {
      label: "Completed Jobs",
      value: summary.done,
      icon: CheckCircle2,
      tone: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    },
    {
      label: "Waiting Response",
      value: summary.waiting,
      icon: Clock3,
      tone: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    },
  ];

  const CustomCountTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ value: number }>;
    label?: string;
  }) => {
    if (!active || !payload?.length) return null;

    return (
      <div className="rounded-2xl border border-slate-800 bg-[#16171d] px-4 py-3 shadow-[0_18px_40px_-26px_rgba(0,0,0,0.45)]">
        <p className="text-[11px] font-medium text-slate-400">{label}</p>
        <p className="mt-1 text-sm font-semibold text-slate-100">{payload[0].value} leads</p>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[1450px] space-y-6 text-slate-100">
      {/* Header Block */}
      <div className="relative overflow-hidden rounded-[28px] border border-slate-800 bg-[#15161c] p-6 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.45)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.02),transparent_28%)]" />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <motion.div variants={heroTitle} initial="initial" animate="animate">
            <div className="mb-3 inline-flex items-center gap-1 rounded-full border border-blue-500/10 bg-blue-500/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-400">
              <Sparkles className="h-2.5 w-2.5" />
              Advanced Analytics
            </div>

            <h1 className="text-2xl font-bold tracking-[-0.03em] text-slate-100 sm:text-3xl">Operations Performance</h1>
            <p className="mt-2 text-sm text-slate-400">
              Monitor conversions, stage progressions, response rates, and team assignments.
            </p>
          </motion.div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-2xl border border-slate-800 bg-[#0e0f12] p-1.5 shadow-[0_14px_34px_-28px_rgba(0,0,0,0.35)]">
              {(["7d", "30d", "90d", "all"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setDateFilter(r);
                    setCustomStart("");
                    setCustomEnd("");
                  }}
                  className={cn(
                    "rounded-xl px-4 py-2 text-[12px] font-semibold transition-all duration-200",
                    dateFilter === r
                      ? "bg-[#1d1f27] text-slate-100 shadow-sm border border-slate-800/40"
                      : "text-slate-400 hover:text-slate-200",
                  )}
                >
                  {r === "all" ? "All Time" : r}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => {
                  setCustomStart(e.target.value);
                  setDateFilter("custom");
                }}
                className="h-9 w-[130px] rounded-xl border border-slate-800 bg-[#0e0f12] px-3 text-[11px] text-slate-100"
              />
              <span className="text-[10px] text-slate-500">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => {
                  setCustomEnd(e.target.value);
                  setDateFilter("custom");
                }}
                className="h-9 w-[130px] rounded-xl border border-slate-800 bg-[#0e0f12] px-3 text-[11px] text-slate-100"
              />
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label}>
            <Card className="rounded-2xl border border-slate-800 bg-[#15161c] shadow-[0_14px_40px_-28px_rgba(0,0,0,0.35)]">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {stat.label}
                    </p>
                    <p className="mt-2 text-2xl font-bold tracking-[-0.03em] text-slate-100 tabular-nums">
                      {stat.value}
                    </p>
                    <p className={cn(
                      "mt-1 text-[11px] font-medium flex items-center gap-1",
                      stat.sub.startsWith("-") ? "text-red-400" : stat.sub.startsWith("0") ? "text-slate-500" : "text-emerald-400"
                    )}>
                      {stat.sub}
                    </p>
                  </div>

                  <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl border", stat.tone)}>
                    <stat.icon className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      {/* Main Layout Rows */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          {/* Daily Leads Volume */}
          <Card className="rounded-[28px] border border-slate-800 bg-[#15161c] shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-5">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-slate-200">Daily Leads Intake</h3>
                <p className="mt-1 text-[12px] text-slate-400">Track the number of leads received daily over the period.</p>
              </div>

              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barCategoryGap={10}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#22242e" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<CustomCountTooltip />} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                    <Bar dataKey="count" fill="hsl(217, 91%, 60%)" radius={[8, 8, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Lead Funnel Analysis */}
          <Card className="rounded-[28px] border border-slate-800 bg-[#15161c] shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-5">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-slate-200">Operational Conversion Funnel</h3>
                <p className="mt-1 text-[12px] text-slate-400">Conversion stages of leads captured in range.</p>
              </div>

              <div className="space-y-4 py-2">
                {funnelData.map((step) => (
                  <div key={step.step} className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-slate-300">{step.step}</span>
                      <span className="text-slate-100 flex items-center gap-2">
                        <span>{step.count} leads</span>
                        <span className="text-slate-500">|</span>
                        <span className="text-blue-400">{step.pct}% conversion</span>
                      </span>
                    </div>
                    <div className="relative h-3.5 w-full overflow-hidden rounded-full bg-slate-900 border border-slate-800/80">
                      <div
                        className={cn("h-full rounded-full transition-all duration-500", step.color)}
                        style={{ width: `${step.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Lead Aging Analysis */}
          <Card className="rounded-[28px] border border-slate-800 bg-[#15161c] shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-5">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-slate-200">Active Lead Aging (Unresolved)</h3>
                <p className="mt-1 text-[12px] text-slate-400">Duration active leads have remained in pipeline.</p>
              </div>

              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agingData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#22242e" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<CustomCountTooltip />} />
                    <Bar dataKey="count" radius={[8, 8, 0, 0]} isAnimationActive={false}>
                      {agingData.map((entry, idx) => (
                        <Cell key={`cell-${idx}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Columns */}
        <div className="space-y-6">
          {/* Pipelines status list */}
          <Card className="rounded-[28px] border border-slate-800 bg-[#15161c] shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-4">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-slate-200">CRM Pipelines Status</h3>
                <p className="mt-1 text-[12px] text-slate-400">
                  Global pipelines summary of all leads in database.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {statusSummary.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-2xl border border-slate-800/80 bg-[#0e0f12]/50 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl border", item.tone)}>
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-slate-200">{item.label}</p>
                        <p className="text-[11px] text-slate-500">Pipeline active leads</p>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-xl font-bold tracking-[-0.03em] text-slate-100 tabular-nums">
                        {item.value}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* CS Agent Performance */}
          <Card className="rounded-[28px] border border-slate-800 bg-[#15161c] shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-4">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-slate-200">CS Agent Performance</h3>
                <p className="mt-1 text-[12px] text-slate-400">Leads assigned per CS staff representative.</p>
              </div>

              {agentPerformance.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">No agent assignments recorded yet.</div>
              ) : (
                <div className="space-y-4">
                  {agentPerformance.map((item) => (
                    <div key={item.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="truncate text-slate-300 flex items-center gap-1.5">
                          <UserCheck className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          {item.name}
                        </span>
                        <span className="text-slate-100">{item.count} leads</span>
                      </div>
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-900">
                        <div
                          className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full"
                          style={{
                            width: `${currentStats.totalLeads > 0 ? (item.count / currentStats.totalLeads) * 100 : 0}%`
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span>Active range</span>
                        <span>
                          {currentStats.totalLeads > 0
                            ? ((item.count / currentStats.totalLeads) * 100).toFixed(0)
                            : 0}
                          % share
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Service Types Performance */}
          <Card className="rounded-[28px] border border-slate-800 bg-[#15161c] shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-4">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-slate-200">Top Service Sectors</h3>
                <p className="mt-1 text-[12px] text-slate-400">Distribution by lead volume.</p>
              </div>

              {serviceDistribution.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">No services metadata recorded yet.</div>
              ) : (
                <div className="space-y-4">
                  {serviceDistribution.map((item) => (
                    <div key={item.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="truncate text-slate-300 flex items-center gap-1.5">
                          <Briefcase className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          {item.name}
                        </span>
                        <span className="text-slate-100">{item.count} leads</span>
                      </div>
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-900">
                        <div
                          className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full"
                          style={{
                            width: `${currentStats.totalLeads > 0 ? (item.count / currentStats.totalLeads) * 100 : 0}%`
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span>Active range</span>
                        <span>
                          {currentStats.totalLeads > 0
                            ? ((item.count / currentStats.totalLeads) * 100).toFixed(0)
                            : 0}
                          % share
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Lead Generating Sources */}
          <Card className="rounded-[28px] border border-slate-800 bg-[#15161c] shadow-[0_18px_52px_-34px_rgba(0,0,0,0.42)]">
            <CardContent className="p-6">
              <div className="mb-4">
                <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-slate-200">Top Ingestion Sources</h3>
                <p className="mt-1 text-[12px] text-slate-400">Leads grouped by phone line or scraper source.</p>
              </div>

              {sourceDistribution.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">No lead sources mapped in this range.</div>
              ) : (
                <div className="space-y-4">
                  {sourceDistribution.map((item) => (
                    <div key={item.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="truncate text-slate-300 flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          {item.name}
                        </span>
                        <span className="text-slate-100">{item.count} leads</span>
                      </div>
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-900">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full"
                          style={{
                            width: `${currentStats.totalLeads > 0 ? (item.count / currentStats.totalLeads) * 100 : 0}%`
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span>Active range</span>
                        <span>
                          {currentStats.totalLeads > 0
                            ? ((item.count / currentStats.totalLeads) * 100).toFixed(0)
                            : 0}
                          % share
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Analytics;

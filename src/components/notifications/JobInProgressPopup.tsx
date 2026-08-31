import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, X, ArrowUpRight, Wrench, MapPin, AlertCircle, Calendar } from "lucide-react";

interface JobInProgressItem {
  notificationId: string;
  leadId: string | null;
  title: string;
  message: string;
  createdAt: string;
  customerName?: string;
  expectedCompletionDate?: string | null;
  techName?: string | null;
  serviceType?: string | null;
  city?: string | null;
  state?: string | null;
}

const POLL_MS = 25000;

export default function JobInProgressPopup() {
  const { user, role, fullyAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<JobInProgressItem[]>([]);

  // Only Admins and Processors receive Job in Progress popups
  const isEligible = (role === "admin" || role === "processor") && Boolean(user) && fullyAuthenticated;

  const fetchReminders = useCallback(async () => {
    if (!user || !isEligible) return;

    try {
      // 1. Fetch unread Job in Progress notifications for this user
      const { data: notifications, error } = await supabase
        .from("notifications")
        .select("id, title, message, lead_id, created_at, read")
        .eq("user_id", user.id)
        .eq("read", false)
        .ilike("title", "%Job in Progress%")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error || !notifications || notifications.length === 0) {
        setItems([]);
        return;
      }

      // 2. Extract lead IDs to get up-to-date expected details
      const leadIds = notifications
        .map((n) => n.lead_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      const leadDetailsMap = new Map<string, {
        customer_name: string;
        expected_completion_date: string | null;
        tech_name: string | null;
        service_type: string | null;
        city: string | null;
        state: string | null;
      }>();

      if (leadIds.length > 0) {
        const { data: leads } = await supabase
          .from("leads")
          .select("id, customer_name, expected_completion_date, tech_name, service_type, city, state")
          .in("id", leadIds);

        if (leads) {
          leads.forEach((l) => leadDetailsMap.set(l.id, l));
        }
      }

      // 3. Construct the list of popup items
      const newItems: JobInProgressItem[] = notifications.map((n) => {
        const details = n.lead_id ? leadDetailsMap.get(n.lead_id) : undefined;
        return {
          notificationId: n.id,
          leadId: n.lead_id,
          title: n.title,
          message: n.message,
          createdAt: n.created_at,
          customerName: details?.customer_name || "Lead",
          expectedCompletionDate: details?.expected_completion_date || null,
          techName: details?.tech_name || null,
          serviceType: details?.service_type || null,
          city: details?.city || null,
          state: details?.state || null,
        };
      });

      setItems(newItems);
    } catch (err) {
      console.warn("Failed to fetch Job in Progress reminders", err);
    }
  }, [user, isEligible]);

  useEffect(() => {
    if (!isEligible) return;
    void fetchReminders();
    const interval = setInterval(fetchReminders, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchReminders, isEligible]);

  // Realtime subscription for instant pop-up when notification is inserted
  useEffect(() => {
    if (!user || !isEligible) return;

    const channel = supabase
      .channel(`job-in-progress-popup:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as { title?: string } | undefined;
          if (row?.title?.toLowerCase().includes("job in progress")) {
            void fetchReminders();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isEligible, fetchReminders]);

  const dismiss = async (item: JobInProgressItem) => {
    // Optimistically remove from state
    setItems((prev) => prev.filter((i) => i.notificationId !== item.notificationId));

    // Mark as read in Supabase so it never appears again
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", item.notificationId);
  };

  const dismissAll = async () => {
    const ids = items.map((i) => i.notificationId);
    setItems([]);
    if (ids.length > 0) {
      await supabase
        .from("notifications")
        .update({ read: true })
        .in("id", ids);
    }
  };

  const openLead = async (item: JobInProgressItem) => {
    await dismiss(item);
    if (item.leadId) {
      navigate(`/leads/${item.leadId}`);
    }
  };

  if (!isEligible || items.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      {/* Dimmed backdrop in the middle of the screen */}
      <div className="pointer-events-none fixed inset-0 z-[95] bg-background/60 backdrop-blur-sm" />

      <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="pointer-events-auto flex w-full max-w-[540px] flex-col gap-3">
          <AnimatePresence initial={false}>
            {items.map((item, idx) => {
              const isOverdue = item.expectedCompletionDate ? item.expectedCompletionDate < today : false;
              const isDueToday = item.expectedCompletionDate ? item.expectedCompletionDate === today : false;

              return (
                <motion.div
                  key={item.notificationId}
                  layout
                  initial={{ opacity: 0, scale: 0.9, y: 25 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92, y: -15, transition: { duration: 0.18 } }}
                  transition={{ type: "spring", stiffness: 280, damping: 26 }}
                  className="relative overflow-hidden rounded-3xl border-2 border-sky-400/60 bg-card p-0 shadow-[0_30px_70px_-15px_rgba(14,165,233,0.35)] dark:shadow-[0_30px_70px_-15px_rgba(2,132,199,0.25)]"
                >
                  {/* Top gradient highlight bar */}
                  <div className="h-1.5 w-full bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-400 animate-pulse" />

                  <div className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-600 ring-2 ring-sky-400/30 dark:bg-sky-500/20 dark:text-sky-300">
                        <Clock className="h-6 w-6" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wide">
                              Job in Progress
                            </span>
                            {isOverdue && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                                <AlertCircle className="h-3 w-3" />
                                Overdue
                              </span>
                            )}
                            {isDueToday && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                <Clock className="h-3 w-3" />
                                Due Today
                              </span>
                            )}
                          </div>

                          {items.length > 1 && (
                            <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-200">
                              {idx + 1} of {items.length}
                            </span>
                          )}
                        </div>

                        {/* Customer Name */}
                        <h3 className="mt-1 text-[17px] font-bold text-foreground truncate">
                          {item.customerName}
                        </h3>

                        {/* Expected Job Details Card */}
                        <div className="mt-3 grid grid-cols-1 gap-2 rounded-2xl border border-border/60 bg-muted/30 p-3 text-[12px] sm:grid-cols-2">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                            <span>Expected:</span>
                            <span className="font-semibold text-foreground">
                              {item.expectedCompletionDate || "Not specified"}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Wrench className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                            <span>Technician:</span>
                            <span className="font-semibold text-foreground truncate">
                              {item.techName || "Unassigned"}
                            </span>
                          </div>

                          {item.serviceType && (
                            <div className="flex items-center gap-2 text-muted-foreground col-span-1 sm:col-span-2">
                              <span className="h-1.5 w-1.5 rounded-full bg-sky-500 shrink-0" />
                              <span>Service:</span>
                              <span className="font-medium text-foreground truncate">
                                {item.serviceType}
                              </span>
                            </div>
                          )}

                          {(item.city || item.state) && (
                            <div className="flex items-center gap-2 text-muted-foreground col-span-1 sm:col-span-2">
                              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="truncate">
                                {[item.city, item.state].filter(Boolean).join(", ")}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="mt-4 flex flex-wrap items-center gap-2.5">
                          {item.leadId && (
                            <button
                              type="button"
                              onClick={() => openLead(item)}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-sky-700 hover:shadow"
                            >
                              Open Lead <ArrowUpRight className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => dismiss(item)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
                          >
                            Dismiss
                          </button>
                          {items.length > 1 && idx === 0 && (
                            <button
                              type="button"
                              onClick={dismissAll}
                              className="ml-auto text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Dismiss all ({items.length})
                            </button>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => dismiss(item)}
                        aria-label="Dismiss notification"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}

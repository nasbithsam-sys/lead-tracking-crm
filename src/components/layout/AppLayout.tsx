import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AppSidebar from "@/components/layout/AppSidebar";
import NotificationBell from "@/components/notifications/NotificationBell";
import UrgentLeadPopup from "@/components/notifications/UrgentLeadPopup";
import JobInProgressPopup from "@/components/notifications/JobInProgressPopup";
import CrmUpdatePopup from "@/components/notifications/CrmUpdatePopup";
import ThemeToggle from "@/components/ThemeToggle";
import { NotepadProvider, useNotepad } from "@/contexts/NotepadContext";
import FloatingNotepad from "@/components/notepad/FloatingNotepad";
import { Outlet, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { premiumEase, pageVariants } from "@/lib/motion";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlobalCommandMenu } from "@/components/layout/GlobalCommandMenu";

function HeaderNotepadTrigger() {
  const { toggleNotepad, activeUserIds, isPickerOpen } = useNotepad();
  const hasActive = activeUserIds.length > 0 || isPickerOpen;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => toggleNotepad()}
      className={`relative h-9 w-9 rounded-xl transition-all duration-200 ${
        hasActive
          ? "bg-primary/15 text-primary border border-primary/20 shadow-sm"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      }`}
      title="Open Notepad Manager"
    >
      <FileText className="h-4 w-4" />
      {hasActive && (
        <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary animate-pulse" />
      )}
    </Button>
  );
}

export default function AppLayout() {
  const location = useLocation();
  const pageMeta: Record<string, { title: string; subtitle: string }> = {
    "/leads": { title: "Leads", subtitle: "Track intake, ownership, and next actions." },
    "/lead-cancellation-requests": { title: "Cancellation Requests", subtitle: "Review cancellation reasons and approve or decline requests." },
    "/schedule": { title: "Schedule", subtitle: "Review jobs by day, week, and date range." },
    "/analytics": { title: "Analytics", subtitle: "Watch volume, pace, and operational trends." },
    "/areas": { title: "Areas", subtitle: "Compare neighborhoods and service performance." },
    "/activity-logs": { title: "Activity", subtitle: "Audit recent actions across the workspace." },
    "/quo-monitor": { title: "QUO Dashboard", subtitle: "Live webhook chats, incoming triage, and lead status management." },
    "/quo-dashboard": { title: "QUO Dashboard", subtitle: "Live webhook chats, incoming triage, and lead status management." },
    "/settings": { title: "Settings", subtitle: "Manage users, permissions, and security controls." },
    "/crm-updates": { title: "CRM Updates", subtitle: "Broadcast one-time live update notifications to selected CRM roles." },
  };

  const activeMeta =
    Object.entries(pageMeta).find(([path]) => location.pathname.startsWith(path))?.[1] ??
    pageMeta["/leads"];
  const isQuoMonitor = location.pathname.startsWith("/quo-monitor");

  return (
    <NotepadProvider>
      <SidebarProvider>
        <GlobalCommandMenu />
        <div className="min-h-screen flex w-full bg-[radial-gradient(circle_at_0%_0%,hsl(195_100%_84%/0.56),transparent_18%),radial-gradient(circle_at_18%_12%,hsl(206_100%_88%/0.5),transparent_22%),radial-gradient(circle_at_84%_10%,hsl(212_100%_89%/0.46),transparent_22%),radial-gradient(circle_at_50%_34%,hsl(188_100%_92%/0.34),transparent_28%),radial-gradient(circle_at_14%_100%,hsl(197_100%_89%/0.24),transparent_24%),linear-gradient(180deg,hsl(202_100%_99%),hsl(206_100%_97%)_54%,hsl(210_100%_95.5%))] dark:bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_22%),radial-gradient(circle_at_top_right,hsl(196_100%_68%/0.10),transparent_20%),linear-gradient(180deg,hsl(var(--background)),hsl(225_22%_8%))]">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <header className="glass-panel-strong sticky top-0 z-30 shrink-0 gap-4 border-b border-border/50 px-4 py-3 shadow-[0_18px_34px_-26px_rgba(59,130,246,0.18)] sm:px-5 sm:py-3.5 dark:shadow-none">
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, ease: premiumEase }}
                className="flex items-center gap-3 sm:gap-4"
              >
                <SidebarTrigger className="hover:bg-accent rounded-lg transition-colors duration-200" />
                <div className="hidden h-4 w-px bg-border/40 sm:block" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">
                      Marshmallow
                    </span>
                    <span className="hidden h-1 w-1 rounded-full bg-border/80 sm:block" />
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={activeMeta.title}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2, ease: premiumEase }}
                        className="truncate text-sm font-semibold tracking-[-0.02em] text-foreground"
                      >
                        {activeMeta.title}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={activeMeta.subtitle}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="mt-0.5 hidden text-[13px] text-muted-foreground sm:block"
                    >
                      {activeMeta.subtitle}
                    </motion.p>
                  </AnimatePresence>
                </div>
                <div className="flex items-center gap-2">
                  <HeaderNotepadTrigger />
                  <ThemeToggle />
                  {!isQuoMonitor && <NotificationBell />}
                </div>
              </motion.div>
            </header>
            <main className="relative flex-1 overflow-auto px-4 py-4 sm:px-5 sm:py-5 md:px-6 md:py-6 lg:px-8 lg:py-7">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_8%,hsl(194_100%_84%/0.18),transparent_18%),radial-gradient(circle_at_88%_12%,hsl(211_100%_88%/0.18),transparent_16%),radial-gradient(circle_at_46%_28%,hsl(188_100%_91%/0.12),transparent_22%),radial-gradient(circle_at_50%_100%,hsl(196_100%_88%/0.1),transparent_26%)]" />
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  variants={pageVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="relative"
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
          {!isQuoMonitor && <UrgentLeadPopup />}
          {!isQuoMonitor && <JobInProgressPopup />}
          <CrmUpdatePopup />
          <FloatingNotepad />
        </div>
      </SidebarProvider>
    </NotepadProvider>
  );
}


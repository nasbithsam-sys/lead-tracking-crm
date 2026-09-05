import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { memo } from "react";
import { differenceInCalendarDays, startOfDay, isBefore } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLastMessageFromCustomer } from "@/hooks/useIsLastMessageFromCustomer";
import { Lead, LeadStatus, STATUS_LABELS, getChangeableStatuses, canChangeStatus } from "@/lib/constants";
import { CS_TAG_LABELS, type CsTag } from "@/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  UserCircle,
  Phone,
  MapPin,
  UserRound,
  Trash2,
  Pencil,
  MessageSquare,
  Wrench,
  ChevronDown,
  Image as ImageIcon,
  CalendarDays,
  CalendarClock,
  ShieldCheck,
  Copy,
  Check,
  Clipboard,
  ExternalLink,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import NoteThread from "./NoteThread";
import PaymentDialog from "./PaymentDialog";
import LeadShareDialog from "./LeadShareDialog";
import StatusBadge from "./StatusBadge";
import CopyValueButton from "./CopyValueButton";
import CancellationRequestDialog from "./CancellationRequestDialog";
import QuoPhoneTrigger from "./QuoPhoneTrigger";
import FloatingQuoMessagePreview from "./FloatingQuoMessagePreview";
import { adminApi } from "@/lib/admin-api";
import { logActivity } from "@/lib/activity";
import { buildCompleteLeadCopyText, copyTextToClipboard } from "@/lib/lead-copy";
import {
  canCreateCancellationRequest,
  createCancellationRequest,
  fetchPendingCancellationRequest,
} from "@/lib/cancellation-requests";
import { createPaymentRequest } from "@/lib/payment-requests";
import type { LeadCancellationRequest } from "@/types";
import { optimizeImageForUpload } from "@/lib/image-upload";
import { getAssignableLeadTags } from "@/lib/lead-tags";
import BookingDateTimeDialog, { formatBookingCompact, isBookingExpired } from "./BookingDateTimeDialog";
import AssignLeadToOperatorDialog from "./AssignLeadToOperatorDialog";
import ActivateCustomerNoteDialog from "./ActivateCustomerNoteDialog";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useQuoAttention } from "@/hooks/useQuoAttention";

interface LeadCardProps {
  lead: Lead;
  profiles: Record<string, string>;
  onRefresh: () => void;
  photoUrls?: string[];
  disablePhotoPreview?: boolean;
  initialHasNotes?: { general: boolean; cs: boolean; processor: boolean };
  initialPhotoCount?: number;
  initialPhotoPaths?: string[];
  initialPendingCancellationRequest?: LeadCancellationRequest | null;
}

const NOTE_INDICATOR_START_AT = new Date("2026-06-12T12:01:26.000Z").getTime();

function formatDateTime(value?: string | null) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatDate(value?: string | null) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

type ScheduleDateEntry = { month: number; day: number; year?: number; endDay?: number };

const SCHEDULE_WEEKDAYS: Record<string, string> = {
  sunday: "Sun", sun: "Sun",
  monday: "Mon", mon: "Mon",
  tuesday: "Tue", tue: "Tue", tues: "Tue",
  wednesday: "Wed", wed: "Wed",
  thursday: "Thu", thu: "Thu", thur: "Thu", thurs: "Thu",
  friday: "Fri", fri: "Fri",
  saturday: "Sat", sat: "Sat",
};

const SCHEDULE_MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const SCHEDULE_MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SCHEDULE_MONTH_RX = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function findDatesInScheduleText(rawSeg: string): ScheduleDateEntry[] {
  const TIME_RANGE_RX_G = /(?<!\d[-/])\b(?:noon|midnight|\d{1,2}(?::\d{2})?)\s*(?:-|–|—|to)\s*(?:noon|midnight|\d{1,2}(?::\d{2})?)\s*(?:a\.?m\.?|p\.?m\.?)?(?![-/]\d)/gi;
  const TIME_SINGLE_RX_G = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b(?:noon|midnight)\b/gi;
  const seg = rawSeg.replace(TIME_RANGE_RX_G, " ").replace(TIME_SINGLE_RX_G, " ");
  const results: ScheduleDateEntry[] = [];
  const nowMonth = new Date().getMonth();

  const push = (mo: number, d: number, endD?: number, yr?: number) => {
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return;
    if (endD !== undefined && (endD < d || endD > 31)) return;
    if (endD === undefined && results.some((r) => r.month === mo && r.day === d && r.endDay === undefined)) return;
    results.push({ month: mo, day: d, endDay: endD, year: yr });
  };

  // 1. ISO date: YYYY-MM-DD or YYYY/MM/DD
  const iso = rawSeg.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) {
    push(Number(iso[2]) - 1, Number(iso[3]), undefined, Number(iso[1]));
  }

  // 2. Slash date: MM/DD/YYYY or DD/MM/YYYY
  const slash = rawSeg.match(/(?<!\d[-/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d)/);
  if (slash) {
    const p1 = Number(slash[1]);
    const p2 = Number(slash[2]);
    const yr = slash[3] ? (Number(slash[3]) < 100 ? 2000 + Number(slash[3]) : Number(slash[3])) : undefined;
    if (p1 > 12 && p2 <= 12) {
      push(p2 - 1, p1, undefined, yr);
    } else if (p1 <= 12) {
      push(p1 - 1, p2, undefined, yr);
    }
  }

  // Date range: "August 25, 2026 to August 29, 2026" or "August 25 to August 29"
  const rangeMonthFirst = seg.match(
    new RegExp(
      `\\b${SCHEDULE_MONTH_RX}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\s+(?:to|through|until|–|-)\\s+${SCHEDULE_MONTH_RX}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\b`,
      "i"
    )
  );
  if (rangeMonthFirst) {
    const m1 = SCHEDULE_MONTHS[rangeMonthFirst[1].toLowerCase()];
    const m2 = SCHEDULE_MONTHS[rangeMonthFirst[4].toLowerCase()];
    if (m1 !== undefined && m2 !== undefined) {
      const yr = rangeMonthFirst[6]
        ? Number(rangeMonthFirst[6]) < 100
          ? 2000 + Number(rangeMonthFirst[6])
          : Number(rangeMonthFirst[6])
        : rangeMonthFirst[3]
        ? Number(rangeMonthFirst[3]) < 100
          ? 2000 + Number(rangeMonthFirst[3])
          : Number(rangeMonthFirst[3])
        : undefined;

      if (m1 === m2) {
        push(m1, Number(rangeMonthFirst[2]), Number(rangeMonthFirst[5]), yr);
        return results;
      }
    }
  }

  // Date range: "27th July to 31st July"
  const rangeA = seg.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${SCHEDULE_MONTH_RX}\\s+(?:to|through|until|–|-)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${SCHEDULE_MONTH_RX}(?:,?\\s+(\\d{2,4}))?\\b`, "i"));
  if (rangeA && SCHEDULE_MONTHS[rangeA[2].toLowerCase()] === SCHEDULE_MONTHS[rangeA[4].toLowerCase()]) {
    const yr = rangeA[5] ? (Number(rangeA[5]) < 100 ? 2000 + Number(rangeA[5]) : Number(rangeA[5])) : undefined;
    push(SCHEDULE_MONTHS[rangeA[2].toLowerCase()], Number(rangeA[1]), Number(rangeA[3]), yr);
    return results;
  }

  // "27th to 31st July"
  const rangeB = seg.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:to|through|until|–|-)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${SCHEDULE_MONTH_RX}(?:,?\\s+(\\d{2,4}))?\\b`, "i"));
  if (rangeB) {
    const yr = rangeB[4] ? (Number(rangeB[4]) < 100 ? 2000 + Number(rangeB[4]) : Number(rangeB[4])) : undefined;
    push(SCHEDULE_MONTHS[rangeB[3].toLowerCase()], Number(rangeB[1]), Number(rangeB[2]), yr);
    return results;
  }

  // "July 27-31" / "July 27 to 31"
  const rangeC = seg.match(new RegExp(`\\b${SCHEDULE_MONTH_RX}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|to|through|until)\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\b`, "i"));
  if (rangeC) {
    const yr = rangeC[4] ? (Number(rangeC[4]) < 100 ? 2000 + Number(rangeC[4]) : Number(rangeC[4])) : undefined;
    push(SCHEDULE_MONTHS[rangeC[1].toLowerCase()], Number(rangeC[2]), Number(rangeC[3]), yr);
    return results;
  }

  // Grouped: "21st or 22nd July", "20, 21 July"
  const grouped = seg.match(new RegExp(`((?:\\d{1,2}(?:st|nd|rd|th)?)(?:\\s*(?:,|&|and|or|\\/)\\s*\\d{1,2}(?:st|nd|rd|th)?)+)\\s+${SCHEDULE_MONTH_RX}(?:,?\\s+(\\d{2,4}))?\\b`, "i"));
  if (grouped) {
    const mo = SCHEDULE_MONTHS[grouped[2].toLowerCase()];
    const yr = grouped[3] ? (Number(grouped[3]) < 100 ? 2000 + Number(grouped[3]) : Number(grouped[3])) : undefined;
    const days = grouped[1]
      .split(/,|&|\band\b|\bor\b|\//i)
      .map((s) => Number(s.replace(/\D/g, "")))
      .filter((d) => d >= 1 && d <= 31);
    if (mo !== undefined) days.forEach((d) => push(mo, d, undefined, yr));
    return results;
  }

  // "21st July 2026" / "21 July"
  let m: RegExpExecArray | null;
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${SCHEDULE_MONTH_RX}(?:,?\\s+(\\d{2,4}))?\\b`, "gi");
  while ((m = dm.exec(seg)) !== null) {
    const yr = m[3] ? (Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    push(SCHEDULE_MONTHS[m[2].toLowerCase()], Number(m[1]), undefined, yr);
  }

  // "July 21, 2026" / "July 21"
  const md = new RegExp(`\\b${SCHEDULE_MONTH_RX}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\b`, "gi");
  while ((m = md.exec(seg)) !== null) {
    const yr = m[3] ? (Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    push(SCHEDULE_MONTHS[m[1].toLowerCase()], Number(m[2]), undefined, yr);
  }

  // Bare ordinal — use current month
  if (results.length === 0) {
    const ord = seg.match(/\b(\d{1,2})(st|nd|rd|th)\b/i);
    if (ord) push(nowMonth, Number(ord[1]));
  }

  results.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.month - b.month || a.day - b.day);
  return results;
}

function isScheduleRequirementFarFuture(text?: string | null, daysThreshold = 3): boolean {
  if (!text || !text.trim()) return false;
  const dates = findDatesInScheduleText(text);
  if (!dates || dates.length === 0) return false;

  const now = startOfDay(new Date());
  const currentYear = now.getFullYear();

  const calendarDates = dates.map((d) => {
    const y = d.year ?? currentYear;
    let dt = startOfDay(new Date(y, d.month, d.day));
    if (!d.year && isBefore(dt, now) && d.month < now.getMonth()) {
      dt = startOfDay(new Date(currentYear + 1, d.month, d.day));
    }
    return dt;
  });

  const futureDates = calendarDates.filter((dt) => !isBefore(dt, now));
  if (futureDates.length === 0) {
    return false;
  }

  const earliestFuture = futureDates.sort((a, b) => a.getTime() - b.getTime())[0];
  const diffDays = differenceInCalendarDays(earliestFuture, now);
  return diffDays > daysThreshold;
}

function formatScheduleRequirementCompact(text?: string | null): { summary: string; full: string } | null {
  if (!text) return null;
  const full = text.trim();
  if (!full) return null;

  const lower = full.toLowerCase();

  type PT = { h: number; m: number; ap: "am" | "pm" | null };
  const parseTimeToken = (str: string): PT | null => {
    if (/noon/i.test(str)) return { h: 12, m: 0, ap: "pm" };
    if (/midnight/i.test(str)) return { h: 12, m: 0, ap: "am" };
    const m = str.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
    if (!m) return null;
    const h = Number(m[1]);
    if (h > 24) return null;
    return { h, m: m[2] ? Number(m[2]) : 0, ap: m[3] ? (m[3][0].toLowerCase() === "p" ? "pm" : "am") : null };
  };
  const displayHr = (h: number) => (h === 0 ? 12 : h > 12 ? h - 12 : h);
  const fmtOne = (t: PT, inheritAp: "am" | "pm" | null = null) => {
    const ap = t.ap ?? inheritAp;
    let s = String(displayHr(t.h));
    if (t.m) s += `:${String(t.m).padStart(2, "0")}`;
    if (ap) s += ` ${ap.toUpperCase()}`;
    return s;
  };

  const findTime = (seg: string): string | null => {
    const rangeRe = new RegExp(
      `(?:from\\s+)?(noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?)\\s*(?:-|–|—|to)\\s*(noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?)`,
      "i",
    );
    const r = seg.match(rangeRe);
    if (r) {
      const t1 = parseTimeToken(r[1]);
      const t2 = parseTimeToken(r[2]);
      if (t1 && t2) {
        const ap1 = t1.ap ?? t2.ap;
        const ap2 = t2.ap ?? ap1;
        if (ap1 && ap2 && ap1 === ap2) {
          const h1 = `${displayHr(t1.h)}${t1.m ? `:${String(t1.m).padStart(2, "0")}` : ""}`;
          const h2 = `${displayHr(t2.h)}${t2.m ? `:${String(t2.m).padStart(2, "0")}` : ""}`;
          return `${h1}–${h2} ${ap2.toUpperCase()}`;
        }
        return `${fmtOne(t1, ap1)}–${fmtOne(t2, ap2)}`;
      }
    }
    const a = seg.match(/\b(after|before|around|by|past)\s+(noon|midnight|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/i);
    if (a) {
      const t = parseTimeToken(a[2]);
      if (t) {
        const ap = t.ap ?? (t.h >= 8 && t.h <= 11 ? "am" : t.h >= 1 && t.h <= 7 ? "pm" : null);
        return `${a[1].toLowerCase()} ${fmtOne(t, ap)}`;
      }
    }
    const single = seg.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b|\b(noon|midnight)\b/i);
    if (single) {
      const t = parseTimeToken(single[0]);
      if (t) return fmtOne(t);
    }
    if (/\bmorning\b/i.test(seg)) return "Morning";
    if (/\bafternoon\b/i.test(seg)) return "Afternoon";
    if (/\bevening\b/i.test(seg)) return "Evening";
    if (/\banytime\b|\ball\s*day\b/i.test(seg)) return "Anytime";
    return null;
  };

  const findWeekdays = (seg: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const re = /\b(sunday|sun|monday|mon|tuesday|tues?|wednesday|wed|thursday|thurs?|thu|friday|fri|saturday|sat)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(seg)) !== null) {
      const w = SCHEDULE_WEEKDAYS[m[1].toLowerCase()];
      if (w && !seen.has(w)) { seen.add(w); out.push(w); }
    }
    return out;
  };

  const fmtDate = (d: ScheduleDateEntry) => {
    const base = `${SCHEDULE_MONTH_SHORT[d.month]} ${d.day}`;
    return d.endDay ? `${base} to ${SCHEDULE_MONTH_SHORT[d.month]} ${d.endDay}` : base;
  };

  const joinTime = (dayPart: string, time: string | null): string => {
    if (!time) return dayPart;
    if (!dayPart) return time;
    if (/^(after|before|around|by|past)\s/i.test(time)) return `${dayPart} ${time}`;
    return `${dayPart} · ${time}`;
  };

  const renderSeg = (seg: string, assignedDate?: ScheduleDateEntry): string => {
    const weekdays = findWeekdays(seg);
    const dates = assignedDate ? [assignedDate] : findDatesInScheduleText(seg);
    const time = findTime(seg);
    const dayStrs: string[] = [];
    if (dates.length) {
      for (let i = 0; i < dates.length; i++) {
        const wd = weekdays[i] ?? (weekdays.length === 1 ? weekdays[0] : "");
        const s = fmtDate(dates[i]);
        dayStrs.push(wd ? `${wd} ${s}` : s);
      }
    } else {
      for (const wd of weekdays) dayStrs.push(wd);
    }
    return joinTime(dayStrs.join(" / "), time);
  };

  // Extract trailing parenthetical of dates so weekday-only segments can be paired to them.
  let workingText = full;
  let sharedDates: ScheduleDateEntry[] = [];
  const parenMatch = full.match(/\(([^)]+)\)\s*$/);
  if (parenMatch && parenMatch.index !== undefined) {
    const innerDates = findDatesInScheduleText(parenMatch[1]);
    if (innerDates.length) {
      sharedDates = innerDates;
      workingText = full.slice(0, parenMatch.index).trim();
    }
  }

  // Split into option segments. Only split on " or " / ";" / " / " when followed by a capitalized token
  // (avoids breaking "Mon 3/4" style content).
  const rawSegs = workingText
    .split(/\n|\s+or\s+|\s*;\s*|\s*\/\s*(?=[A-Z])/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const segments = rawSegs.length > 1 ? rawSegs : [workingText];

  let summary = "";
  if (sharedDates.length && sharedDates.length === segments.length) {
    summary = segments.map((s, i) => renderSeg(s, sharedDates[i])).filter(Boolean).join(" / ");
  } else if (sharedDates.length === 1 && segments.length >= 1) {
    const bodies = segments.map((s) => renderSeg(s)).filter(Boolean);
    const dateStr = fmtDate(sharedDates[0]);
    const joined = bodies.join(" / ");
    summary = joined ? (joined.includes(SCHEDULE_MONTH_SHORT[sharedDates[0].month]) ? joined : `${dateStr} · ${joined}`) : dateStr;
  } else if (segments.length === 1) {
    summary = renderSeg(segments[0]);
  } else {
    summary = segments.map((s) => renderSeg(s)).filter(Boolean).join(" / ");
  }

  // Preserve flexibility wording when meaningful
  const anyDay = /\bany\s*day\b/i.test(full);
  const anyTime = /\bany\s*time\b/i.test(full);
  const flexible = /\bflex(ible)?\b|\bwhenever\b/i.test(full);
  let flexTag = "";
  if (anyDay && anyTime) flexTag = "Any Day & Time";
  else if (anyDay) flexTag = "Any Day";
  else if (anyTime) flexTag = "Anytime";
  else if (flexible) flexTag = "Flexible";
  if (flexTag) {
    if (!summary) summary = flexTag;
    else if (!new RegExp(flexTag.replace(/&/g, "&").replace(/\s+/g, "\\s+"), "i").test(summary)) {
      summary = `${summary} · ${flexTag}`;
    }
  }

  if (!summary) {
    const hasWeekend = /\bweekend\b/.test(lower);
    const hasNextWeek = /\bnext\s+week\b/.test(lower);
    const hasThisWeek = /\bthis\s+week\b/.test(lower);
    if (hasWeekend) summary = "Weekend · Flexible";
    else if (hasNextWeek) summary = "Next week · Flexible";
    else if (hasThisWeek) summary = "This week · Flexible";
    else summary = full.length > 32 ? full.slice(0, 30).trim() + "…" : full;
  }

  if (summary.length > 64) summary = summary.slice(0, 62).trim() + "…";
  return { summary, full };
}

function formatScheduleForCopy(lead: Lead) {
  const date = lead.scheduled_date || "TBD";
  const start = lead.scheduled_time_start || "";
  const end = lead.scheduled_time_end || "";
  const time = start && end ? `${start} - ${end}` : start || end;
  return time ? `${date}, ${time}` : date;
}

function LeadCard({
  lead,
  profiles,
  onRefresh,
  photoUrls,
  disablePhotoPreview = false,
  initialHasNotes,
  initialPhotoCount,
  initialPhotoPaths,
  initialPendingCancellationRequest,
}: LeadCardProps) {
  const navigate = useNavigate();
  const { user, role, profile, canAccess } = useAuth();
  const [changingStatus, setChangingStatus] = useState(false);
  const [csOpen, setCsOpen] = useState(false);
  const [processorOpen, setProcessorOpen] = useState(false);
  const [generalOpen, setGeneralOpen] = useState(false);
  const [oprOpen, setOprOpen] = useState(false);
  const [generalPinned, setGeneralPinned] = useState(false);
  const [csPinned, setCsPinned] = useState(false);
  const [processorPinned, setProcessorPinned] = useState(false);
  const [oprPinned, setOprPinned] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [cancelRequestOpen, setCancelRequestOpen] = useState(false);
  const [cancelRequestLoading, setCancelRequestLoading] = useState(false);
  const [cancelReviewLoading, setCancelReviewLoading] = useState(false);
  const [pendingCancellationRequest, setPendingCancellationRequest] = useState<LeadCancellationRequest | null>(
    initialPendingCancellationRequest !== undefined ? initialPendingCancellationRequest : null
  );
  const [completeCopied, setCompleteCopied] = useState(false);
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const [bookingDialogMode, setBookingDialogMode] = useState<"add" | "edit">("add");
  const [assignOprOpen, setAssignOprOpen] = useState(false);
  const [activateCustomerOpen, setActivateCustomerOpen] = useState(false);
  // Tick every 30s so blinking/expiry state stays fresh without a full refetch.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [photoOriginals, setPhotoOriginals] = useState<(string | undefined)[]>([]);
  const [resolvedPaymentOriginal, setResolvedPaymentOriginal] = useState<string | null>(null);
  const [photoCount, setPhotoCount] = useState(
    initialPhotoCount !== undefined ? initialPhotoCount : 0
  );
  const [hasNotes, setHasNotes] = useState<{ general: boolean; cs: boolean; processor: boolean; opr: boolean }>(
    initialHasNotes !== undefined ? { ...initialHasNotes, opr: false } : {
      general: false,
      cs: false,
      processor: false,
      opr: false,
    }
  );
  const reduceMotion = useReducedMotion();
  const { needsAttention: quoNeedsAttention } = useQuoAttention({
    leadId: lead.id,
    phone: lead.customer_phone,
    status: lead.status,
    updatedAt: lead.updated_at,
  });

  useEffect(() => {
    if (initialHasNotes !== undefined) {
      setHasNotes({ ...initialHasNotes, opr: false });
    }
  }, [initialHasNotes]);

  useEffect(() => {
    if (initialPhotoCount !== undefined) {
      setPhotoCount(initialPhotoCount);
    }
  }, [initialPhotoCount]);

  useEffect(() => {
    if (initialPendingCancellationRequest !== undefined) {
      setPendingCancellationRequest(initialPendingCancellationRequest);
    }
  }, [initialPendingCancellationRequest]);

  const shouldShowPersistentNoteDots = () => {
    const createdAt = new Date(lead.created_at).getTime();
    return !Number.isNaN(createdAt) && createdAt >= NOTE_INDICATOR_START_AT;
  };

  const refreshNotePresence = async () => {
    if (!shouldShowPersistentNoteDots()) {
      setHasNotes({ general: false, cs: false, processor: false, opr: false });
      return;
    }

    const { data } = await supabase
      .from("lead_notes")
      .select("note_type")
      .eq("lead_id", lead.id);
    if (!data) return;

    const present = new Set((data as { note_type: string }[]).map((row) => row.note_type));
    setHasNotes({
      general: present.has("general"),
      cs: present.has("cs"),
      processor: present.has("processor"),
      opr: present.has("opr"),
    });
  };

  useEffect(() => {
    if (initialHasNotes === undefined) {
      void refreshNotePresence();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.created_at, initialHasNotes]);

  const loadPhotoCount = async () => {
    if (photoUrls) {
      setPhotoCount(photoUrls.length);
      return;
    }

    const { count } = await supabase
      .from("lead_photos")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", lead.id);

    setPhotoCount(count ?? 0);
  };

  useEffect(() => {
    if (initialPhotoCount === undefined) {
      void loadPhotoCount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, photoUrls, initialPhotoCount]);

  const refreshPendingCancellationRequest = async () => {
    const request = await fetchPendingCancellationRequest(lead.id);
    setPendingCancellationRequest(request);
  };

  useEffect(() => {
    if (initialPendingCancellationRequest === undefined) {
      void refreshPendingCancellationRequest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, lead.status, initialPendingCancellationRequest]);

  const refreshCardMeta = () => {
    void refreshNotePresence();
    void loadPhotoCount();
    void refreshPendingCancellationRequest();
  };

  const isAdmin = role === "admin";
  const hasQuickChatAccess = canAccess("quick_chat");
  const hasTechQuickChatAccess = canAccess("tech_quick_chat");
  const isCS = role === "customer_service";
  const isCsAdmin = role === "cs_admin";
  const isProcessor = role === "processor";
  const isPaid = lead.status === "paid";
  const isUrgent = lead.status === "urgent_job";
  const canCompleteCopy = isAdmin || isProcessor;
  const pictureLabel = photoCount === 1 ? "Picture attached" : "Pictures attached";
  const currentTag = lead.cs_tag ?? null;
  const assignableTags = getAssignableLeadTags(role);

  const hasScheduleTag =
    currentTag === "ready_to_schedule" ||
    currentTag === "confirmation_sent" ||
    currentTag === "waiting_schedule_confirmation" ||
    currentTag === "booked";

  const { isFromCustomer } = useIsLastMessageFromCustomer(lead.customer_phone, hasScheduleTag);
  const needsScheduleBlink = hasScheduleTag && isFromCustomer;
  const isActivateCustomer = lead.status === "activate_customer";
  const baseShouldBlink = needsScheduleBlink || isActivateCustomer;

  // Suppress blink if schedule requirement date is more than 3 days in the future
  const isFarFutureSchedule = isScheduleRequirementFarFuture(lead.customer_schedule_requirements, 3);
  const shouldBlinkCard = baseShouldBlink && !isFarFutureSchedule;

  const handleCompleteCopy = async () => {
    const text = buildCompleteLeadCopyText(lead);
    if (!text) {
      toast.error("No service details, address, schedule requirement, or quote available to copy");
      return;
    }

    await copyTextToClipboard(text);
    setCompleteCopied(true);
    toast.success("Complete lead details copied");
    window.setTimeout(() => setCompleteCopied(false), 1400);
  };

  const handleCopySingleImage = async (thumbnailUrl: string, index: number) => {
    toast.info("Copying image...");
    try {
      const isPaymentImage = isPaid && lead.payment_screenshot_url && index === 0;
      const photoIndex = isPaid && lead.payment_screenshot_url ? index - 1 : index;
      let originalUrl = isPaymentImage ? resolvedPaymentOriginal : photoOriginals[photoIndex];

      if (isPaymentImage) {
        if (resolvedPaymentOriginal) {
          originalUrl = resolvedPaymentOriginal;
        } else {
          const { getSignedUrl } = await import("@/lib/storage");
          const original = await getSignedUrl(lead.payment_screenshot_url!);
          if (original) {
            originalUrl = original;
            setResolvedPaymentOriginal(original);
          }
        }
      } else {
        if (!originalUrl) {
          const knownPath = photoPaths[photoIndex];
          if (knownPath) {
            const path = knownPath;
            const { getSignedUrl } = await import("@/lib/storage");
            const original = await getSignedUrl(path);
            if (original) {
              originalUrl = original;
              const updatedOriginals = [...photoOriginals];
              updatedOriginals[photoIndex] = original;
              setPhotoOriginals(updatedOriginals);
            }
          }
        }
      }

      const copyUrl = originalUrl || thumbnailUrl;
      const { copyImageToClipboard } = await import("@/lib/lead-copy");
      await copyImageToClipboard(copyUrl);
    } catch (err) {
      console.error("Failed to copy image:", err);
      toast.error("Failed to copy image");
    }
  };

  const detailRows = [
    {
      key: "phone",
      label: "Contact",
      value: lead.customer_phone,
      icon: Phone,
      wrap: false,
    },
    {
      key: "address",
      label: "Address",
      value: lead.address,
      icon: MapPin,
      wrap: true,
    },
    {
      key: "technician",
      label: "Technician",
      value: [lead.tech_name, lead.tech_number].filter(Boolean).join(" · "),
      icon: UserRound,
      wrap: true,
    },
    {
      key: "source_url",
      label: "Source URL",
      value: lead.source_url,
      icon: ExternalLink,
      wrap: true,
    },
  ].filter((row): row is { key: string; label: string; value: string; icon: LucideIcon; wrap: boolean } => Boolean(row.value));

  // Reload key can be kept in case we need it to force updates
  const [reloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (disablePhotoPreview) {
      setPhotoPaths([]);
      return;
    }

    if (initialPhotoPaths !== undefined) {
      setPhotoPaths(initialPhotoPaths);
      setPhotoCount(initialPhotoPaths.length);
      return;
    }

    const loadPhotos = async () => {
      const { data } = await supabase
        .from("lead_photos")
        .select("photo_url")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: true });

      if (!data || cancelled) return;

      const paths = data.map((photo: { photo_url: string }) => photo.photo_url);
      setPhotoCount(paths.length);

      if (!cancelled) {
        setPhotoPaths(paths);
      }
    };

    void loadPhotos();

    return () => {
      cancelled = true;
    };
  }, [disablePhotoPreview, initialPhotoPaths, lead.id, reloadKey]);

  const handleCopyPaymentScreenshot = async () => {
    if (!lead.payment_screenshot_url) return;
    toast.info("Copying payment screenshot...");
    try {
      const { getSignedUrl } = await import("@/lib/storage");
      const original = await getSignedUrl(lead.payment_screenshot_url);
      if (original) {
        const { copyImageToClipboard } = await import("@/lib/lead-copy");
        await copyImageToClipboard(original);
        toast.success("Payment screenshot copied to clipboard!");
      }
    } catch (err) {
      console.error("Failed to copy image:", err);
      toast.error("Failed to copy payment screenshot");
    }
  };

  const handleCopyPhotoLink = async (path: string, index: number) => {
    toast.info(`Copying Photo ${index + 1}...`);
    try {
      const { getSignedUrl } = await import("@/lib/storage");
      const original = await getSignedUrl(path);
      if (original) {
        const { copyImageToClipboard } = await import("@/lib/lead-copy");
        await copyImageToClipboard(original);
        toast.success(`Photo ${index + 1} copied to clipboard!`);
      }
    } catch (err) {
      console.error("Failed to copy image:", err);
      toast.error(`Failed to copy Photo ${index + 1}`);
    }
  };

  const handleStatusChange = async (newStatus: string, cancellationReason?: string) => {
    if (isPaid) return;
    if (!canChangeStatus(role, newStatus as LeadStatus)) {
      toast.error("You do not have permission to set that status");
      return;
    }

    if (newStatus === "paid") {
      setPaymentOpen(true);
      return;
    }

    if (newStatus === "cancelled" && cancellationReason === undefined) {
      // Only open the dialog when not already coming from the dialog submit
      setCancelRequestOpen(true);
      return;
    }

    if (newStatus === "activate_customer" && (isAdmin || isProcessor)) {
      setActivateCustomerOpen(true);
      return;
    }

    setChangingStatus(true);

    const statusUpdate: Record<string, unknown> = {
      status: newStatus as LeadStatus,
      last_edited_by: user?.id,
      last_edited_by_name: profile?.full_name || user?.email || "Unknown user",
      updated_at: new Date().toISOString(),
      last_edited_at: new Date().toISOString(),
    };
    // Clear tag on any status change and unpin the lead
    statusUpdate.cs_tag = null;

    if (newStatus === "cancelled") {
      statusUpdate.cancellation_reason = cancellationReason || null;
    }

    const { error } = await supabase
      .from("leads")
      .update(statusUpdate as never)
      .eq("id", lead.id);

    setChangingStatus(false);

    if (error) {
      toast.error("Failed to update status");
      return;
    }

    toast.success(`Status -> ${STATUS_LABELS[newStatus as LeadStatus]}`);

    try {
      const { syncLeadUpsertToGoogleSheets } = await import("@/lib/google-sheets");
      void syncLeadUpsertToGoogleSheets({ ...lead, ...statusUpdate } as Lead, lead.status, lead.cs_tag ?? undefined).catch((err) => {
        console.warn("Google Sheets status sync failed:", err);
      });
    } catch {
      // ignore
    }

    await logActivity(user!.id, "status_changed", "lead", lead.id, {
      target_name: lead.job_id,
      customer_name: lead.customer_name,
      job_id: lead.job_id,
      status_from: lead.status,
      status_to: newStatus,
      changes: {
        status: {
          before: lead.status,
          after: newStatus,
        },
      },
    });

    if (newStatus === "urgent_job" || newStatus === "need_tech") {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["admin", "processor", "customer_service", "opr"]);

      if (roles) {
        const statusLabel = newStatus === "urgent_job" ? "Urgent Job" : "Need Tech";
        const notifs = roles.map((r: { user_id: string }) => ({
          user_id: r.user_id,
          title: `[Alert] ${statusLabel}`,
          message: `Lead "${lead.customer_name}" changed to ${statusLabel}`,
          lead_id: lead.id,
          read: false,
        }));
        await supabase.from("notifications").insert(notifs);
      }
    }

    onRefresh();
  };

 const handleCancellationRequestSubmit = async (comment: string, proof: string, proofImage: File | null) => {
    if (!user) return;

    setCancelRequestLoading(true);
    try {
      if (isAdmin) {
        // Admin cancels directly — no request tab needed
        let proofImagePath: string | null = null;
        if (proofImage) {
          const { optimizeImageForUpload } = await import("@/lib/image-upload");
          const optimized = await optimizeImageForUpload(proofImage);
          const ext = optimized.name.split(".").pop() || "jpg";
          proofImagePath = `cancellation-requests/${lead.id}_${Date.now()}.${ext}`;
          const { error: uploadError } = await supabase.storage.from("lead-photos").upload(proofImagePath, optimized);
          if (uploadError) throw uploadError;
        }
        const reason = [
          comment.trim() ? `Comment: ${comment.trim()}` : "",
          proof.trim() ? `Proof: ${proof.trim()}` : "",
          proofImagePath ? `Proof image: ${proofImagePath}` : "",
        ].filter(Boolean).join("\n");
        await handleStatusChange("cancelled", reason);
      } else {
        // CS / Processor — send to cancellation requests tab
        await createCancellationRequest({
          lead,
          userId: user.id,
          userName: profile?.full_name || user.email || "Unknown user",
          requesterRole: role,
          comment,
          proof,
          proofImage,
        });
        toast.success("Cancellation request sent for approval");
        await refreshPendingCancellationRequest();
        onRefresh();
      }
      setCancelRequestOpen(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel lead");
    } finally {
      setCancelRequestLoading(false);
    }
  };
  const handlePaymentConfirm = async (amount: number, screenshotFile: File | null, comment?: string) => {
    if (!user) return;
    setPaymentLoading(true);
    try {
      if (isProcessor) {
        // Processor -> send Paid approval request (Admin must approve)
        await createPaymentRequest({
          lead,
          userId: user.id,
          userName: profile?.full_name || user.email || "Unknown user",
          requesterRole: role,
          amount,
          comment,
          screenshotFile,
        });
        toast.success("Paid request sent for Admin approval");
        setPaymentOpen(false);
        onRefresh();
        return;
      }

      // Admin (or any other bypass) -> mark Paid directly
      let screenshotUrl: string | null = null;
      if (screenshotFile) {
        const optimizedScreenshot = await optimizeImageForUpload(screenshotFile);
        const ext = optimizedScreenshot.name.split(".").pop();
        const path = `payments/${lead.id}_${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("lead-photos").upload(path, optimizedScreenshot);
        if (!uploadError) screenshotUrl = path;
      }

      const { error } = await supabase
        .from("leads")
        .update({
          status: "paid" as LeadStatus,
          amount,
          payment_amount: amount,
          payment_screenshot_url: screenshotUrl,
          last_edited_by: user?.id,
          last_edited_by_name: profile?.full_name || user?.email || "Unknown user",
          updated_at: new Date().toISOString(),
          last_edited_at: new Date().toISOString(),
        })
        .eq("id", lead.id);

      if (error) {
        toast.error("Failed to update status");
        return;
      }

      try {
        const { syncLeadUpsertToGoogleSheets } = await import("@/lib/google-sheets");
        void syncLeadUpsertToGoogleSheets({ ...lead, status: "paid" as LeadStatus, amount, payment_amount: amount, payment_screenshot_url: screenshotUrl } as Lead, lead.status).catch((err) => {
          console.warn("Google Sheets payment sync failed:", err);
        });
      } catch {
        // ignore
      }

      await logActivity(user.id, "payment_recorded", "lead", lead.id, {
        target_name: lead.job_id,
        customer_name: lead.customer_name,
        job_id: lead.job_id,
        amount,
        status_from: lead.status,
        status_to: "paid",
        changes: {
          status: { before: lead.status, after: "paid" },
          payment_amount: { before: lead.payment_amount ?? null, after: amount },
          payment_screenshot_url: { before: lead.payment_screenshot_url ?? null, after: screenshotUrl ?? null },
        },
      });

      toast.success("Payment recorded & status updated to Paid");
      setPaymentOpen(false);
      onRefresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setPaymentLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      await adminApi.deleteLead(lead.id, lead.job_id);

      await logActivity(user!.id, "deleted", "lead", lead.id, {
        target_name: lead.job_id,
        customer_name: lead.customer_name,
        job_id: lead.job_id,
        message: `${profiles[user!.id] || "Unknown"} deleted lead "${lead.customer_name}".`,
      });

      toast.success("Lead deleted");
      onRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to delete lead: " + message);
    }
  };

  const persistCsTag = async (
    newTag: CsTag | null,
    opts: { bookedAt?: string | null } = {},
  ) => {
    const patch: Record<string, unknown> = {
      cs_tag: newTag,
      last_edited_by: user?.id,
      last_edited_by_name: profile?.full_name || user?.email || "Unknown user",
      updated_at: new Date().toISOString(),
      last_edited_at: new Date().toISOString(),
    };
    // Only touch booked_at when the tag transition affects it: on "booked" save
    // the picked timestamp; on any move away from booked, clear it.
    if (Object.prototype.hasOwnProperty.call(opts, "bookedAt")) {
      patch.booked_at = opts.bookedAt;
    } else if (newTag !== "booked" && lead.cs_tag === "booked") {
      patch.booked_at = null;
    }

    const { error } = await supabase
      .from("leads")
      .update(patch as never)
      .eq("id", lead.id);
    if (error) {
      toast.error("Failed to update tag");
      return false;
    }
    toast.success(newTag ? `Tag: ${CS_TAG_LABELS[newTag]}` : "Tag cleared");

    try {
      const { syncLeadUpsertToGoogleSheets } = await import("@/lib/google-sheets");
      void syncLeadUpsertToGoogleSheets({ ...lead, ...patch } as Lead, undefined, lead.cs_tag ?? undefined).catch((err) => {
        console.warn("Google Sheets tag sync failed:", err);
      });
    } catch {
      // ignore
    }

    onRefresh();
    return true;
  };

  const handleCsTagChange = async (value: string) => {
    const newTag = value === "__clear__" ? null : (value as CsTag);
    if (newTag && !assignableTags.includes(newTag)) {
      toast.error("You do not have permission to assign this tag");
      return;
    }

    // Booked tag requires a booking date/time before it's applied.
    if (newTag === "booked") {
      setBookingDialogMode("add");
      setBookingDialogOpen(true);
      return;
    }

    await persistCsTag(newTag);
  };

  const handleBookingConfirm = async (iso: string) => {
    if (bookingDialogMode === "edit") {
      // Editing an already-booked lead — keep tag, just update booked_at.
      const { error } = await supabase
        .from("leads")
        .update({
          booked_at: iso,
          last_edited_by: user?.id,
          last_edited_by_name: profile?.full_name || user?.email || "Unknown user",
          updated_at: new Date().toISOString(),
          last_edited_at: new Date().toISOString(),
        } as never)
        .eq("id", lead.id);
      if (error) {
        toast.error("Failed to update booking time");
        return;
      }
      toast.success("Booking time updated");
      onRefresh();
      return;
    }
    await persistCsTag("booked", { bookedAt: iso });
  };


interface NoteCollapsibleProps {
  open: boolean;
  setOpen: (v: boolean) => void;
  pinned: boolean;
  setPinned: (v: boolean) => void;
  label: string;
  noteType: "general" | "cs" | "processor" | "opr";
  tone?: "default" | "cs" | "processor" | "opr";
  hasNotes?: boolean;
  reduceMotion?: boolean;
  leadId: string;
  profiles: Record<string, string>;
  refreshCardMeta: () => void;
}

function NoteCollapsible({
  open,
  setOpen,
  pinned,
  setPinned,
  label,
  noteType,
  tone = "default",
  hasNotes = false,
  reduceMotion,
  leadId,
  profiles,
  refreshCardMeta,
}: NoteCollapsibleProps) {
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    };
  }, []);

  const toneClasses =
    tone === "cs"
      ? "crm-lead-card-soft border-amber-200/70 bg-[linear-gradient(180deg,hsl(42_100%_99%/0.86),hsl(42_100%_96%/0.7))] shadow-[0_14px_22px_-20px_rgba(245,158,11,0.12)] hover:border-amber-300/75 hover:bg-[linear-gradient(180deg,hsl(42_100%_99%/0.92),hsl(42_100%_96%/0.76))] dark:border-amber-400/22 dark:bg-[linear-gradient(180deg,hsl(34_34%_20%/0.94),hsl(32_28%_18%/0.9))] dark:shadow-none"
      : tone === "processor"
        ? "crm-lead-card-soft border-sky-200/72 bg-[linear-gradient(180deg,hsl(198_100%_99%/0.86),hsl(201_100%_96%/0.72))] shadow-[0_14px_22px_-20px_rgba(59,130,246,0.12)] hover:border-sky-300/78 hover:bg-[linear-gradient(180deg,hsl(198_100%_99%/0.92),hsl(201_100%_96%/0.78))] dark:border-sky-400/20 dark:bg-[linear-gradient(180deg,hsl(210_38%_20%/0.95),hsl(214_32%_18%/0.9))] dark:shadow-none"
        : tone === "opr"
          ? "crm-lead-card-soft border-emerald-200/70 bg-[linear-gradient(180deg,hsl(152_100%_99%/0.86),hsl(155_100%_96%/0.7))] shadow-[0_14px_22px_-20px_rgba(16,185,129,0.12)] hover:border-emerald-300/75 hover:bg-[linear-gradient(180deg,hsl(152_100%_99%/0.92),hsl(155_100%_96%/0.76))] dark:border-emerald-400/22 dark:bg-[linear-gradient(180deg,hsl(158_34%_20%/0.94),hsl(156_28%_18%/0.9))] dark:shadow-none"
          : "crm-lead-card-soft shadow-[0_16px_26px_-22px_rgba(59,130,246,0.12)] hover:border-primary/20 hover:bg-[linear-gradient(180deg,hsl(210_100%_99%/0.98),hsl(212_100%_97%/0.86))] dark:bg-[linear-gradient(180deg,hsl(223_22%_18%/0.94),hsl(224_20%_16%/0.9))] dark:shadow-none";

  const dotColor =
    tone === "cs" ? "bg-amber-500" : tone === "processor" ? "bg-sky-500" : tone === "opr" ? "bg-emerald-500" : "bg-primary";

  const handleMouseEnter = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    if (!open) {
      enterTimerRef.current = setTimeout(() => {
        setOpen(true);
      }, 160);
    }
  };

  const handleMouseLeave = () => {
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    if (!pinned) {
      leaveTimerRef.current = setTimeout(() => {
        setOpen(false);
      }, 220);
    }
  };

  return (
    <div
      className="w-full"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Collapsible
        open={open}
        onOpenChange={(nextOpen) => {
          if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
          if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
          if (nextOpen) {
            setPinned(true);
            setOpen(true);
          } else {
            setPinned(false);
            setOpen(false);
          }
        }}
      >
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
              if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
              if (pinned) {
                setPinned(false);
                setOpen(false);
              } else {
                setPinned(true);
                setOpen(true);
              }
            }}
            className={`w-full justify-between h-9 rounded-xl border px-3 text-[12px] text-muted-foreground hover:text-foreground ${toneClasses}`}
          >
            <span className="flex items-center gap-2">
              <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
                <MessageSquare className="h-3.5 w-3.5" />
                {hasNotes && (
                  <span className="absolute -right-1 -top-1 flex h-2 w-2">
                    <span
                      className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotColor} opacity-70`}
                    />
                    <span className={`relative inline-flex h-2 w-2 rounded-full ${dotColor}`} />
                  </span>
                )}
              </span>
              <span className="font-medium">{label}</span>
              {hasNotes && (
                <span className={`text-[10px] font-semibold ${tone === "cs" ? "text-amber-600 dark:text-amber-300" : tone === "processor" ? "text-sky-600 dark:text-sky-300" : "text-primary"}`}>
                  has notes
                </span>
              )}
            </span>
            <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: reduceMotion ? 0 : 0.35, ease: "easeInOut" }}>
              <ChevronDown className="h-3.5 w-3.5" />
            </motion.span>
          </Button>
        </CollapsibleTrigger>

        <AnimatePresence initial={false}>
          {open && (
            <CollapsibleContent forceMount asChild>
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.38,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="overflow-hidden pt-2"
              >
                <NoteThread
                  leadId={leadId}
                  noteType={noteType}
                  label={label}
                  profiles={profiles}
                  onNotesChanged={refreshCardMeta}
                />
              </motion.div>
            </CollapsibleContent>
          )}
        </AnimatePresence>
      </Collapsible>
    </div>
  );
}

  const renderCollapsible = ({
    open,
    setOpen,
    pinned,
    setPinned,
    label,
    noteType,
    tone = "default",
    hasNotes = false,
  }: {
    open: boolean;
    setOpen: (v: boolean) => void;
    pinned: boolean;
    setPinned: (v: boolean) => void;
    label: string;
    noteType: "general" | "cs" | "processor" | "opr";
    tone?: "default" | "cs" | "processor" | "opr";
    hasNotes?: boolean;
  }) => (
    <NoteCollapsible
      open={open}
      setOpen={setOpen}
      pinned={pinned}
      setPinned={setPinned}
      label={label}
      noteType={noteType}
      tone={tone}
      hasNotes={hasNotes}
      reduceMotion={reduceMotion}
      leadId={lead.id}
      profiles={profiles}
      refreshCardMeta={refreshCardMeta}
    />
  );

  return (
    <motion.div
      className="h-full relative"
      whileHover={reduceMotion ? undefined : { y: -4, scale: 1.006 }}
      whileTap={reduceMotion ? undefined : { scale: 0.985 }}
      transition={{ type: "spring", stiffness: 200, damping: 24, mass: 0.6 }}
    >
      {hasQuickChatAccess && <FloatingQuoMessagePreview phone={lead.customer_phone} leadId={lead.id} />}
      <Card
        className={`crm-lead-card group relative flex h-full flex-col overflow-hidden rounded-[30px] transition-shadow duration-500 hover:border-primary/28 hover:shadow-[0_42px_92px_-46px_rgba(59,130,246,0.34),0_20px_36px_-26px_rgba(125,211,252,0.2)] ${
          shouldBlinkCard 
            ? "ring-[3px] ring-emerald-500 border-emerald-500 bg-emerald-500/20 animate-pulse hover:animate-none"
            : isUrgent 
              ? "ring-1 ring-destructive/15 border-destructive/15" 
              : "border-border/60"
        }`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(194_100%_86%/0.18),transparent_32%),radial-gradient(circle_at_top_right,hsl(211_100%_88%/0.22),transparent_28%),radial-gradient(circle_at_bottom_left,hsl(188_100%_90%/0.14),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.26),transparent_42%)] opacity-100 dark:bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.14),transparent_28%),radial-gradient(circle_at_bottom_left,hsl(196_100%_72%/0.08),transparent_24%)]" />
        <div className="pointer-events-none absolute inset-x-6 top-0 h-16 rounded-b-[28px] bg-[linear-gradient(180deg,rgba(255,255,255,0.5),transparent)] blur-xl opacity-90 dark:hidden" />

        {isUrgent && (
          <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-destructive via-destructive/70 to-transparent" />
        )}

        <div className="relative p-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="crm-lead-card-inner flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] border border-primary/16 shadow-[0_16px_24px_-22px_rgba(56,189,248,0.24),inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-primary/18">
                <UserCircle className="h-5 w-5 text-primary/75" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="truncate text-[14px] font-semibold tracking-[-0.015em] text-foreground">
                    {lead.customer_name}
                  </p>
                  {lead.source_url && (
                    <a
                      href={lead.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open source chat on Quo.com"
                      className="inline-flex items-center justify-center rounded-[8px] bg-[#EEFF41] hover:bg-[#F4FF40] text-[#1A237E] font-extrabold text-[9px] px-1.5 py-0.5 tracking-wider transition-all duration-300 border border-[#D4E157] shadow-sm select-none"
                      onClick={(e) => e.stopPropagation()}
                    >
                      QUO
                    </a>
                  )}
                  {lead.service_type && (
                    <span className="crm-lead-card-soft inline-block max-w-[180px] truncate rounded-full border border-sky-200/90 px-2.5 py-1 text-[10px] font-semibold text-foreground/84 shadow-[0_16px_28px_-18px_rgba(59,130,246,0.18)] dark:border-sky-400/18 dark:text-foreground/86">
                      {lead.service_type}
                    </span>
                  )}
                </div>

                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <p className="font-mono text-[10px] text-muted-foreground/70">{lead.job_id}</p>
                  {lead.number_name && (
                    <span className="inline-flex max-w-[160px] items-center gap-1 truncate rounded-full border border-primary/15 bg-primary/[0.07] px-2 py-0.5 text-[10px] font-semibold text-white">
                      <Phone className="h-3 w-3 shrink-0" />
                      <span className="truncate">{lead.number_name}</span>
                    </span>
                  )}
                  {lead.created_at && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
                      <CalendarDays className="h-3 w-3" />
                      {formatDate(lead.created_at)}
                    </span>
                  )}
                  {isActivateCustomer && (
                    <span
                      title="Customer is ready for activation"
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
                    >
                      📌 Activate Customer
                    </span>
                  )}
                  {lead.cs_tag === "booked" && lead.booked_at && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBookingDialogMode("edit");
                        setBookingDialogOpen(true);
                      }}
                      title={isBookingExpired(lead.booked_at) ? "Booking overdue — click to reschedule" : "Edit booking date/time"}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                        isBookingExpired(lead.booked_at)
                          ? "border-rose-500/50 bg-rose-500/15 text-rose-700 dark:text-rose-300 animate-pulse"
                          : "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                      }`}
                    >
                      <CalendarDays className="h-3 w-3" />
                      {formatBookingCompact(lead.booked_at)}
                    </button>
                  )}
                  {(() => {
                    const sched = formatScheduleRequirementCompact(lead.customer_schedule_requirements);
                    if (!sched) return null;
                    return (
                      <span
                        title={`Schedule Requirement: ${sched.full}`}
                        className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/12 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300"
                      >
                        <CalendarClock className="h-3 w-3" />
                        <span className="opacity-80">Schedule Requirement:</span>
                        <span>{sched.summary}</span>
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>


            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <StatusBadge status={lead.status} size="sm" />
              {hasQuickChatAccess && lead.customer_phone && (
                <QuoPhoneTrigger
                  contactName={lead.customer_name}
                  phone={lead.customer_phone}
                  chatType="customer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20 transition-all no-underline shadow-sm"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>CX Quick Chat</span>
                </QuoPhoneTrigger>
              )}
              {hasTechQuickChatAccess && lead.tech_number && (
                <QuoPhoneTrigger
                  contactName={lead.tech_name || "Technician"}
                  phone={lead.tech_number}
                  chatType="tech"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/12 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/22 transition-all no-underline shadow-sm"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span>Tech Quick Chat</span>
                </QuoPhoneTrigger>
              )}
              {quoNeedsAttention && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-300 animate-pulse"
                  title="Customer messaged again on Quo after this lead was resolved/cancelled"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                  Needs attention
                </span>
              )}
            </div>
          </div>

          <div className="mt-2 grid gap-2">
            {detailRows.map(({ key, label, value, icon: Icon, wrap }) => (
              <div
                key={key}
                className="crm-lead-card-inner flex items-start gap-3 rounded-[20px] px-3 py-2.5 text-[13px] text-foreground/88 shadow-[0_16px_24px_-22px_rgba(59,130,246,0.12),inset_0_1px_0_rgba(255,255,255,0.75)] dark:shadow-none"
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-primary/12 bg-primary/[0.06] dark:border-primary/18 dark:bg-primary/[0.08]">
                  <Icon className="h-3.5 w-3.5 text-primary/70" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/72">{label}</p>
                    <CopyValueButton value={value} label={label} className="h-6 w-6 rounded-full" />
                  </div>
                  {key === "phone" ? (
                    <a href={`tel:${value}`} className={`mt-1 text-[13px] font-medium leading-5 text-primary hover:underline inline-block ${wrap ? "break-words" : "truncate"}`} onClick={(e) => e.stopPropagation()}>
                      {value}
                    </a>
                  ) : key === "technician" && lead.tech_number ? (
                    <div className={`mt-1 text-[13px] leading-5 text-foreground/90 ${wrap ? "break-words" : "truncate"}`}>
                      {lead.tech_name ? <span>{lead.tech_name} {" · "}</span> : null}
                      <span>{lead.tech_number}</span>
                    </div>
                  ) : key === "source_url" ? (
                    <a
                      href={value}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 text-[13px] leading-5 text-primary hover:underline inline-flex items-center gap-1 font-medium"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span>Quo Chat Thread</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <p className={`mt-1 text-[13px] leading-5 text-foreground/90 ${wrap ? "break-words" : "truncate"}`}>{value}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {(lead.payment_screenshot_url || photoPaths.length > 0) && (
          <div className="relative px-4 pb-1">
            <div className="crm-lead-card-soft rounded-[24px] p-3.5 shadow-[0_22px_34px_-26px_rgba(59,130,246,0.16)] dark:shadow-none">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                    {lead.payment_screenshot_url && photoPaths.length > 0 ? "Payment & Photos" : photoPaths.length > 0 ? "Photos" : "Payment"}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {lead.payment_screenshot_url && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 gap-1 rounded-lg border border-dashed border-primary/20 bg-primary/[0.02] text-[11px] font-medium text-primary hover:bg-primary/5 active:scale-95"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      void handleCopyPaymentScreenshot();
                    }}
                  >
                    <Copy className="h-2.5 w-2.5" />
                    Payment
                  </Button>
                )}

                {photoPaths.map((path, i) => (
                  <Button
                    key={i}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 gap-1 rounded-lg border border-dashed border-muted-foreground/20 bg-muted-foreground/[0.02] text-[11px] font-medium text-muted-foreground hover:bg-muted-foreground/5 active:scale-95"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      void handleCopyPhotoLink(path, i);
                    }}
                  >
                    <Copy className="h-2.5 w-2.5" />
                    Photo {i + 1}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        {(isCS || isCsAdmin || isProcessor || isAdmin) && lead.status !== "scheduled" && (
          <div className="px-4 pt-2">
            <Select
              value={currentTag ?? "__clear__"}
              onValueChange={handleCsTagChange}
            >
              <SelectTrigger className="crm-lead-card-inner h-9 w-full rounded-[14px] text-[12px] font-medium">
                <SelectValue placeholder="Lead tag (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__clear__" className="text-[12px] text-muted-foreground">
                  No tag
                </SelectItem>
                {currentTag && !assignableTags.includes(currentTag) && (
                  <SelectItem value={currentTag} disabled className="text-[12px]">
                    {CS_TAG_LABELS[currentTag]} (view only)
                  </SelectItem>
                )}
                {assignableTags.map((tag) => (
                  <SelectItem key={tag} value={tag} className="text-[12px]">
                    {CS_TAG_LABELS[tag]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentTag && (
              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                <p
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    currentTag === "booked"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/20 dark:text-emerald-200"
                      : currentTag === "ready_to_schedule"
                        ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-400/20 dark:text-indigo-200"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200"
                  }`}
                >
                  📌 {CS_TAG_LABELS[currentTag]}
                </p>
                {currentTag === "booked" && lead.booked_at && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setBookingDialogMode("edit");
                      setBookingDialogOpen(true);
                    }}
                    title={isBookingExpired(lead.booked_at) ? "Booking overdue — click to reschedule" : "Edit booking date/time"}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                      isBookingExpired(lead.booked_at)
                        ? "border-rose-500/50 bg-rose-500/15 text-rose-700 dark:text-rose-300 animate-pulse"
                        : "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                    }`}
                  >
                    <CalendarDays className="h-3 w-3" />
                    {formatBookingCompact(lead.booked_at)}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2 px-4 pt-3">
          {renderCollapsible({
            open: generalOpen,
            setOpen: setGeneralOpen,
            pinned: generalPinned,
            setPinned: setGeneralPinned,
            label: "Notes",
            noteType: "general",
            tone: "default",
            hasNotes: hasNotes.general,
          })}

          {(isCS || isCsAdmin || isProcessor || isAdmin) &&
            renderCollapsible({
              open: csOpen,
              setOpen: setCsOpen,
              pinned: csPinned,
              setPinned: setCsPinned,
              label: "CS Notes",
              noteType: "cs",
              tone: "cs",
              hasNotes: hasNotes.cs,
            })}

          {(isProcessor || isAdmin) &&
            renderCollapsible({
              open: processorOpen,
              setOpen: setProcessorOpen,
              pinned: processorPinned,
              setPinned: setProcessorPinned,
              label: "Processor Notes",
              noteType: "processor",
              tone: "processor",
              hasNotes: hasNotes.processor,
            })}

          {(isProcessor || isAdmin) &&
            renderCollapsible({
              open: oprOpen,
              setOpen: setOprOpen,
              pinned: oprPinned,
              setPinned: setOprPinned,
              label: "OPR Notes",
              noteType: "opr",
              tone: "opr",
              hasNotes: hasNotes.opr,
            })}

          {photoCount > 0 && (
            <div className="crm-lead-card-soft flex items-center justify-between rounded-xl border border-primary/12 px-3 py-2 text-[11px] font-semibold text-primary/85">
              <span className="inline-flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5" />
                {pictureLabel}
              </span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">{photoCount}</span>
            </div>
          )}
        </div>

        <div className="mt-3 px-4">
          {(lead.last_edited_by || lead.last_edited_by_name) && (
            <div className="rounded-[20px] border border-warning/26 bg-[radial-gradient(circle_at_top_left,hsl(48_100%_84%/0.16),transparent_32%),linear-gradient(180deg,hsl(42_100%_98%/0.88),hsl(40_100%_95%/0.72))] px-3.5 py-2.5 shadow-[0_18px_26px_-22px_rgba(245,158,11,0.18)] dark:border-warning/20 dark:bg-[linear-gradient(180deg,hsl(38_24%_21%/0.94),hsl(36_22%_18%/0.9))]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 text-warning/80" />
                <p className="text-[11px] text-muted-foreground/90">
                  Last edited <span className="font-medium text-foreground">{formatDateTime(lead.updated_at)}</span> by{" "}
                  <span className="font-semibold text-foreground">{(lead.last_edited_by ? profiles[lead.last_edited_by] : null) || lead.last_edited_by_name || "Unknown"}</span>
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 pt-3">
          <div className="crm-lead-card-inner rounded-[18px] px-3 py-2 shadow-[0_16px_24px_-22px_rgba(59,130,246,0.14)] dark:shadow-none">
            <p className="text-[10px] text-muted-foreground/80">
              Created by <span className="font-semibold text-foreground">{(lead.created_by ? profiles[lead.created_by] : null) || lead.created_by_name || "Deleted user"}</span>{" "}
              · {formatDate(lead.created_at)}
            </p>
          </div>
        </div>

        <div className="mt-auto border-t border-white/30 px-4 pb-4 pt-4 dark:border-white/5">
          <div className="crm-lead-card-footer rounded-[24px] p-2.5 shadow-[0_24px_40px_-28px_rgba(59,130,246,0.18)] dark:shadow-none">
            <div className="mb-2.5">
              <Select value={lead.status} onValueChange={handleStatusChange} disabled={changingStatus || isPaid}>
                <SelectTrigger
                  className={`crm-lead-card-inner h-10 w-full rounded-[16px] text-[12px] font-medium shadow-[0_18px_28px_-24px_rgba(59,130,246,0.16)] ${
                    isPaid ? "cursor-not-allowed opacity-60" : ""
                  }`}
                >
                  <SelectValue placeholder="Change Status" />
                </SelectTrigger>
                <SelectContent>
                  {getChangeableStatuses(role).map((s) => (
                    <SelectItem key={s} value={s} className="text-[12px]">
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div
              className={`grid items-center gap-1.5 ${
                isAdmin
                  ? "grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_36px_36px_36px]"
                  : isProcessor
                    ? "grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_36px]"
                    : canCompleteCopy
                      ? "grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]"
                      : "grid-cols-1"
              }`}
            >
              <Button
                variant="outline"
                size="sm"
                className="crm-lead-card-inner h-9 min-w-0 w-full overflow-hidden rounded-[14px] px-1.5 text-[10px] font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/28 hover:bg-primary/[0.05] hover:shadow-[0_18px_28px_-20px_rgba(59,130,246,0.2)] dark:hover:bg-primary/[0.10] dark:hover:shadow-none"
                onClick={() => navigate(`/leads/${lead.id}`)}
              >
                <Pencil className="h-3 w-3 shrink-0" />
                <span className="truncate">Edit Lead</span>
              </Button>

              {canCompleteCopy && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="crm-lead-card-inner h-9 min-w-0 w-full gap-1 rounded-[14px] border-border/60 bg-transparent px-1.5 text-[10px] font-semibold hover:border-primary/28 hover:bg-primary/[0.05]"
                  onClick={handleCompleteCopy}
                >
                  {completeCopied ? <Check className="h-3 w-3 shrink-0" /> : <Copy className="h-3 w-3 shrink-0" />}
                  <span className="whitespace-nowrap">{completeCopied ? "Copied" : "Complete Details"}</span>
                </Button>
              )}

              {isAdmin && (
                <LeadShareDialog
                  leadId={lead.id}
                  customerName={lead.customer_name}
                  className="crm-lead-card-inner h-9 w-full rounded-[14px] border-border/60 bg-transparent text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/28 hover:bg-primary/[0.05] hover:shadow-[0_18px_28px_-20px_rgba(59,130,246,0.2)] dark:hover:bg-primary/[0.10] dark:hover:shadow-none"
                />
              )}

              {(isAdmin || isProcessor) && (
                <Button
                  variant="outline"
                  size="icon"
                  className="crm-lead-card-inner h-9 w-full rounded-[14px] text-emerald-600 dark:text-emerald-400 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/30 hover:bg-emerald-500/[0.06] hover:shadow-[0_18px_26px_-20px_rgba(16,185,129,0.22)] dark:hover:shadow-none"
                  onClick={() => setAssignOprOpen(true)}
                  title="Assign to Operator"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                </Button>
              )}

              {isAdmin && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="crm-lead-card-inner h-9 w-full rounded-[14px] text-destructive/60 transition-all duration-200 hover:-translate-y-0.5 hover:border-destructive/30 hover:bg-destructive/[0.06] hover:text-destructive hover:shadow-[0_18px_26px_-20px_rgba(239,68,68,0.22)] dark:hover:shadow-none"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>

                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete lead?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete "{lead.customer_name}". This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        </div>

        <PaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          onConfirm={handlePaymentConfirm}
          loading={paymentLoading}
          mode={isProcessor ? "request" : "direct"}
        />

        <CancellationRequestDialog
          open={cancelRequestOpen}
          onOpenChange={setCancelRequestOpen}
          onSubmit={handleCancellationRequestSubmit}
          loading={cancelRequestLoading}
          mode={isAdmin ? "direct" : "request"}
          requesterLabel={isProcessor ? "Admin" : "Processor or Admin"}
        />

        <BookingDateTimeDialog
          open={bookingDialogOpen}
          onOpenChange={setBookingDialogOpen}
          initialValue={bookingDialogMode === "edit" ? lead.booked_at : null}
          onConfirm={handleBookingConfirm}
          title={bookingDialogMode === "edit" ? "Edit Booking Date & Time" : "Set Booking Date & Time"}
        />

        <AssignLeadToOperatorDialog
          open={assignOprOpen}
          onOpenChange={setAssignOprOpen}
          lead={lead}
          onSuccess={onRefresh}
        />

        <ActivateCustomerNoteDialog
          open={activateCustomerOpen}
          onOpenChange={setActivateCustomerOpen}
          leadId={lead.id}
          customerName={lead.customer_name}
          jobId={lead.job_id}
          currentStatus={lead.status}
          onSuccess={() => {
            onRefresh?.();
            void refreshNotePresence();
          }}
        />

      </Card>
    </motion.div>
  );
}

export default memo(LeadCard);

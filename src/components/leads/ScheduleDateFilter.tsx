import React, { useState, useMemo, useCallback } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, ChevronDown, X } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  SCHEDULE_PRESETS,
  extractAllScheduledDateKeys,
} from "@/lib/schedule-date-filter";
import type { Lead } from "@/lib/constants";

interface ScheduleDateFilterProps {
  date: DateRange | undefined;
  setDate: (date: DateRange | undefined) => void;
  leads: Lead[];
  className?: string;
}

export function ScheduleDateFilter({
  date,
  setDate,
  leads,
  className,
}: ScheduleDateFilterProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isHoverOpen, setIsHoverOpen] = useState(false);

  // Extract all unique dates where leads have customer schedule requirements
  const scheduledDateKeys = useMemo(() => {
    return extractAllScheduledDateKeys(leads);
  }, [leads]);

  // Check if a calendar day has at least one scheduled lead
  const isDateWithSchedule = useCallback(
    (day: Date) => {
      const key = format(day, "yyyy-MM-dd");
      return scheduledDateKeys.has(key);
    },
    [scheduledDateKeys]
  );

  const handleSelectPreset = (preset: (typeof SCHEDULE_PRESETS)[number]) => {
    setDate(preset.getRange());
    setIsHoverOpen(false);
    setIsPopoverOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDate(undefined);
  };

  return (
    <div className={cn("inline-block", className)}>
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <HoverCard
          openDelay={80}
          closeDelay={200}
          open={isHoverOpen && !isPopoverOpen}
          onOpenChange={setIsHoverOpen}
        >
          <HoverCardTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsHoverOpen(false);
                  setIsPopoverOpen((prev) => !prev);
                }}
                className={cn(
                  "gap-1.5 text-[12px] h-9 border-border/60 transition-all duration-200 cursor-pointer",
                  date?.from
                    ? "bg-primary/10 border-primary/40 text-primary font-medium shadow-[0_4px_14px_-6px_rgba(59,130,246,0.35)]"
                    : "hover:bg-muted/30"
                )}
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                {date?.from ? (
                  date.to ? (
                    `${format(date.from, "MMM d")} - ${format(date.to, "MMM d")}`
                  ) : (
                    format(date.from, "MMM d, yyyy")
                  )
                ) : (
                  "Schedule Date"
                )}
                <ChevronDown className="h-3 w-3 opacity-60 ml-0.5" />
                {date?.from && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={handleClear}
                    className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5"
                    title="Clear date filter"
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </Button>
            </PopoverTrigger>
          </HoverCardTrigger>

          {/* Portalled Hover Card (Never clipped by parent card boundary) */}
          <HoverCardContent
            align="end"
            sideOffset={6}
            className="w-56 p-1.5 rounded-xl border border-border/70 bg-popover/95 shadow-2xl backdrop-blur-md z-[100]"
          >
            <div className="px-2.5 py-1 text-[10px] font-bold tracking-wider text-muted-foreground uppercase flex items-center justify-between">
              <span>Schedule Presets</span>
              <span className="text-[9px] font-normal text-muted-foreground/80">Next Days</span>
            </div>

            <div className="space-y-0.5 mt-0.5">
              {SCHEDULE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground font-medium text-left group cursor-pointer"
                >
                  <span className="group-hover:text-primary transition-colors">
                    {preset.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-normal">
                    {preset.sublabel}
                  </span>
                </button>
              ))}
            </div>

            <div className="my-1.5 h-px bg-border/40" />

            <button
              type="button"
              onClick={() => {
                setIsHoverOpen(false);
                setIsPopoverOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-primary transition-colors hover:bg-primary/10 font-medium text-left cursor-pointer"
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              <span>Custom Calendar Range...</span>
            </button>
          </HoverCardContent>
        </HoverCard>

        {/* Full 2-Month Calendar Popover Content */}
        <PopoverContent className="w-auto p-3 z-[100]" align="end" sideOffset={6}>
          <div className="space-y-3">
            {/* Header with Title and Reset */}
            <div className="flex items-center justify-between pb-2 border-b border-border/40">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-foreground">
                  Schedule Requirement Range
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Filter leads by schedule requirement
                </span>
              </div>
              {date?.from && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDate(undefined)}
                  className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                >
                  Reset
                </Button>
              )}
            </div>

            {/* Quick Preset Chips in Popover */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider shrink-0 mr-1">
                Presets:
              </span>
              {SCHEDULE_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleSelectPreset(preset)}
                  className="h-6 text-[11px] px-2 rounded-md font-normal shrink-0 hover:bg-primary/15 hover:text-primary transition-colors"
                >
                  {preset.label}
                </Button>
              ))}
            </div>

            {/* Calendar with Indicator Dots on Scheduled Days */}
            <div className="rounded-lg border border-border/40 p-1">
              <Calendar
                mode="range"
                selected={date}
                onSelect={setDate}
                numberOfMonths={2}
                modifiers={{
                  hasSchedule: isDateWithSchedule,
                }}
                modifiersClassNames={{
                  hasSchedule:
                    "relative after:content-[''] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-1 after:h-1 after:rounded-full after:bg-sky-500 aria-selected:after:bg-white font-medium",
                }}
              />
            </div>

            {/* Small Legend */}
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-sky-500" />
              <span>Indicates dates with customer schedule requirements</span>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

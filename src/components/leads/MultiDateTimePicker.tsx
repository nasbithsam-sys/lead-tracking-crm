import React, { useState } from "react";
import { format, isSameDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  CalendarPlus,
  Calendar as CalendarIcon,
  Clock,
  Check,
  CalendarDays,
  CalendarRange,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function format12Hour(timeStr: string): string {
  if (!timeStr) return "";
  const [hStr, mStr] = timeStr.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr || "0", 10);
  if (isNaN(h)) return timeStr;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const hDisplay = String(h).padStart(2, "0");
  const mDisplay = String(m).padStart(2, "0");
  return `${hDisplay}:${mDisplay} ${ampm}`;
}

interface MultiDateTimePickerProps {
  value: string | null;
  onChange: (val: string) => void;
  readOnly?: boolean;
}

export default function MultiDateTimePicker({
  value,
  onChange,
  readOnly,
}: MultiDateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [calendarPopoverOpen, setCalendarPopoverOpen] = useState(false);

  // Selection mode inside calendar: "multiple" for picking random dates, "range" for date range
  const [pickerMode, setPickerMode] = useState<"multiple" | "range">("multiple");
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  // Time settings
  const [timeMode, setTimeMode] = useState<"none" | "exact" | "window" | "anytime">("none");
  const [exactTime, setExactTime] = useState("09:00");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");

  const handleOpenDialog = () => {
    setSelectedDates([]);
    setDateRange(undefined);
    setPickerMode("multiple");
    setTimeMode("none");
    setExactTime("09:00");
    setStartTime("09:00");
    setEndTime("12:00");
    setOpen(true);
  };

  const getDisplayText = (): string => {
    if (pickerMode === "range") {
      if (!dateRange?.from) return "Pick a date or range";
      if (!dateRange.to || isSameDay(dateRange.from, dateRange.to)) {
        return format(dateRange.from, "MMMM d, yyyy");
      }
      return `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d, yyyy")}`;
    }

    // pickerMode === "multiple"
    if (!selectedDates || selectedDates.length === 0) return "Pick date(s)";
    if (selectedDates.length === 1) return format(selectedDates[0], "MMMM d, yyyy");
    if (selectedDates.length <= 3) {
      return selectedDates
        .map((d) => format(d, "MMM d"))
        .join(", ");
    }
    return `${selectedDates.length} dates selected (${format(selectedDates[0], "MMM d")}...)`;
  };

  const handleConfirm = () => {
    let dateStr = "";

    if (pickerMode === "range") {
      if (!dateRange?.from) return;
      if (!dateRange.to || isSameDay(dateRange.from, dateRange.to)) {
        dateStr = format(dateRange.from, "MMMM d, yyyy");
      } else {
        dateStr = `${format(dateRange.from, "MMMM d, yyyy")} to ${format(dateRange.to, "MMMM d, yyyy")}`;
      }
    } else {
      if (!selectedDates || selectedDates.length === 0) return;
      const sorted = [...selectedDates].sort((a, b) => a.getTime() - b.getTime());
      if (sorted.length === 1) {
        dateStr = format(sorted[0], "MMMM d, yyyy");
      } else {
        dateStr = sorted.map((d) => format(d, "MMMM d, yyyy")).join(" or ");
      }
    }

    if (!dateStr) return;

    let timeStr = "";
    if (timeMode === "exact" && exactTime) {
      timeStr = `at ${format12Hour(exactTime)}`;
    } else if (timeMode === "window" && startTime && endTime) {
      timeStr = `(${format12Hour(startTime)} - ${format12Hour(endTime)})`;
    } else if (timeMode === "anytime") {
      timeStr = "(Anytime)";
    }

    const formattedRequirement = timeStr ? `${dateStr} ${timeStr}`.trim() : dateStr;
    const existing = value ? value.trim() : "";
    const updated = existing ? `${existing}\n${formattedRequirement}` : formattedRequirement;

    onChange(updated);
    setOpen(false);
  };

  const hasDateSelection =
    pickerMode === "range"
      ? !!dateRange?.from
      : selectedDates && selectedDates.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        className="min-h-[88px] resize-none text-[13px] leading-relaxed"
        placeholder="Preferred times, availability (e.g. August 24, 2026 at 10:00 AM, Aug 12 to Aug 16, Anytime, etc.)..."
      />

      {!readOnly && (
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenDialog}
            className="h-8 text-xs flex items-center gap-1.5 font-medium border-border/60 hover:bg-muted/50"
          >
            <CalendarPlus className="h-3.5 w-3.5 text-primary" />
            Add Date & Time
          </Button>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border/40">
            <DialogTitle className="text-base font-semibold">
              Add Schedule Requirement
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              Select one or multiple dates, a date range, and optional time availability.
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 space-y-4">
            {/* Date Selection Section */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5 text-primary" />
                Select Date(s) or Date Range
              </Label>

              <Popover open={calendarPopoverOpen} onOpenChange={setCalendarPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left text-xs h-10 font-normal border-input hover:bg-muted/40",
                      !hasDateSelection && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                    <span className="truncate">{getDisplayText()}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <div className="flex flex-col">
                    {/* Calendar Selection Mode Toggle inside Popover */}
                    <div className="p-2.5 border-b border-border/40 bg-muted/20 flex items-center justify-between gap-2">
                      <div className="inline-flex rounded-lg bg-muted p-0.5 border border-border/50">
                        <button
                          type="button"
                          onClick={() => setPickerMode("multiple")}
                          className={cn(
                            "flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md transition-all",
                            pickerMode === "multiple"
                              ? "bg-background text-foreground shadow-sm font-semibold"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <CalendarDays className="h-3 w-3" />
                          Multiple Dates
                        </button>
                        <button
                          type="button"
                          onClick={() => setPickerMode("range")}
                          className={cn(
                            "flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md transition-all",
                            pickerMode === "range"
                              ? "bg-background text-foreground shadow-sm font-semibold"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <CalendarRange className="h-3 w-3" />
                          Date Range
                        </button>
                      </div>

                      <span className="text-[10px] text-muted-foreground font-medium">
                        {pickerMode === "multiple" ? "Pick single or random dates" : "Pick from / to range"}
                      </span>
                    </div>

                    {/* Calendar Component */}
                    <div className="p-2">
                      {pickerMode === "multiple" ? (
                        <Calendar
                          mode="multiple"
                          selected={selectedDates}
                          onSelect={(dates) => setSelectedDates(dates || [])}
                          className="pointer-events-auto"
                        />
                      ) : (
                        <Calendar
                          mode="range"
                          selected={dateRange}
                          onSelect={setDateRange}
                          className="pointer-events-auto"
                        />
                      )}
                    </div>

                    {/* Calendar Bottom Bar */}
                    <div className="px-3 py-2 border-t border-border/40 bg-muted/10 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                        {hasDateSelection ? getDisplayText() : "Select on calendar"}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs px-3"
                        onClick={() => setCalendarPopoverOpen(false)}
                      >
                        Done
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Time Selection Section */}
            <div className="space-y-2 pt-2 border-t border-border/40">
              <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-primary" />
                Time Availability (Optional)
              </Label>

              {/* Time Mode Quick Tabs */}
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { mode: "none", label: "No Time" },
                  { mode: "exact", label: "Exact Time" },
                  { mode: "window", label: "Window" },
                  { mode: "anytime", label: "Anytime" },
                ].map((item) => (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => setTimeMode(item.mode as any)}
                    className={cn(
                      "py-1.5 px-2 text-xs font-medium rounded-lg border transition-all text-center",
                      timeMode === item.mode
                        ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                        : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Exact Time Input */}
              {timeMode === "exact" && (
                <div className="pt-2 flex items-center gap-2">
                  <Input
                    type="time"
                    value={exactTime}
                    onChange={(e) => setExactTime(e.target.value)}
                    className="h-9 text-xs flex-1"
                  />
                  <span className="text-xs text-muted-foreground font-mono bg-muted/40 px-3 py-2 rounded-lg border border-border/40 whitespace-nowrap">
                    {format12Hour(exactTime) || "12:00 AM"}
                  </span>
                </div>
              )}

              {/* Time Window Inputs */}
              {timeMode === "window" && (
                <div className="pt-2 grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Start Time</Label>
                    <Input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">End Time</Label>
                    <Input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="px-6 py-3 border-t border-border/40 bg-muted/10 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              disabled={!hasDateSelection}
              className="gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Apply Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

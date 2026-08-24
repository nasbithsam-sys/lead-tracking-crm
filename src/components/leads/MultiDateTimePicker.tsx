import React, { useState } from "react";
import { format } from "date-fns";
import {
  CalendarPlus,
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  Clock,
  Check,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface ScheduleSlot {
  id: string;
  date: Date | undefined;
  timeType: "exact" | "window" | "morning" | "afternoon" | "evening" | "anytime";
  exactTime: string;
  startTime: string;
  endTime: string;
}

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

function createEmptySlot(): ScheduleSlot {
  return {
    id: Math.random().toString(36).substring(2, 9),
    date: undefined,
    timeType: "exact",
    exactTime: "09:00",
    startTime: "09:00",
    endTime: "12:00",
  };
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
  const [slots, setSlots] = useState<ScheduleSlot[]>([createEmptySlot()]);

  const handleOpenDialog = () => {
    setSlots([createEmptySlot()]);
    setOpen(true);
  };

  const handleAddSlot = () => {
    setSlots((prev) => [...prev, createEmptySlot()]);
  };

  const handleRemoveSlot = (id: string) => {
    if (slots.length <= 1) return;
    setSlots((prev) => prev.filter((s) => s.id !== id));
  };

  const handleUpdateSlot = <K extends keyof ScheduleSlot>(
    id: string,
    field: K,
    val: ScheduleSlot[K]
  ) => {
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: val } : s))
    );
  };

  const handleConfirm = () => {
    const validSlots = slots.filter((s) => s.date !== undefined);
    if (validSlots.length === 0) return;

    const formattedLines: string[] = [];

    validSlots.forEach((slot, idx) => {
      const dateFormatted = slot.date ? format(slot.date, "MMM d, yyyy") : "";
      let timeFormatted = "";

      if (slot.timeType === "exact") {
        timeFormatted = `at ${format12Hour(slot.exactTime)}`;
      } else if (slot.timeType === "window") {
        timeFormatted = `(${format12Hour(slot.startTime)} - ${format12Hour(slot.endTime)})`;
      } else if (slot.timeType === "morning") {
        timeFormatted = "(Morning: 8:00 AM - 12:00 PM)";
      } else if (slot.timeType === "afternoon") {
        timeFormatted = "(Afternoon: 12:00 PM - 4:00 PM)";
      } else if (slot.timeType === "evening") {
        timeFormatted = "(Evening: 4:00 PM - 8:00 PM)";
      } else if (slot.timeType === "anytime") {
        timeFormatted = "(Anytime)";
      }

      if (validSlots.length === 1) {
        formattedLines.push(`${dateFormatted} ${timeFormatted}`.trim());
      } else {
        formattedLines.push(
          `• Option ${idx + 1}: ${dateFormatted} ${timeFormatted}`.trim()
        );
      }
    });

    const newResult = formattedLines.join("\n");
    const existing = value ? value.trim() : "";
    const updated = existing ? `${existing}\n${newResult}` : newResult;

    onChange(updated);
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        className="min-h-[88px] resize-none text-[13px] leading-relaxed"
        placeholder="Preferred times, availability (e.g. Oct 12 at 10:00 AM, Morning only, etc.)..."
      />

      {!readOnly && (
        <div className="flex justify-end">
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
        <DialogContent className="sm:max-w-[520px] max-h-[85vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border/40">
            <DialogTitle className="text-base font-semibold">
              Add Schedule Requirement
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Add exact booking dates, time windows, or multiple customer availability options.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {slots.map((slot, index) => (
              <div
                key={slot.id}
                className="relative p-3.5 rounded-xl border border-border/60 bg-muted/20 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-primary" />
                    {slots.length > 1 ? `Option ${index + 1}` : "Date & Timing"}
                  </span>
                  {slots.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveSlot(slot.id)}
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      title="Remove option"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* Date Picker */}
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground font-medium">
                      Date (Required)
                    </Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn(
                            "w-full justify-start text-left text-xs h-9 font-normal border-input",
                            !slot.date && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-3.5 w-3.5 text-primary" />
                          {slot.date ? format(slot.date, "PPP") : <span>Pick a date</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={slot.date}
                          onSelect={(d) => handleUpdateSlot(slot.id, "date", d)}
                          initialFocus
                          className="p-3 pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Timing Type Selector */}
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground font-medium">
                      Timing Type
                    </Label>
                    <Select
                      value={slot.timeType}
                      onValueChange={(val: any) =>
                        handleUpdateSlot(slot.id, "timeType", val)
                      }
                    >
                      <SelectTrigger className="h-9 text-xs border-input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="exact">Exact Time</SelectItem>
                        <SelectItem value="window">Time Window (Range)</SelectItem>
                        <SelectItem value="morning">Morning (8am - 12pm)</SelectItem>
                        <SelectItem value="afternoon">Afternoon (12pm - 4pm)</SelectItem>
                        <SelectItem value="evening">Evening (4pm - 8pm)</SelectItem>
                        <SelectItem value="anytime">Anytime / All Day</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Time Selection Inputs */}
                {slot.timeType === "exact" && (
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground font-medium">
                      Exact Time
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={slot.exactTime}
                        onChange={(e) =>
                          handleUpdateSlot(slot.id, "exactTime", e.target.value)
                        }
                        className="h-9 text-xs w-full"
                      />
                      <span className="text-xs text-muted-foreground font-mono bg-muted/50 px-2.5 py-1.5 rounded-lg border border-border/40 whitespace-nowrap">
                        {format12Hour(slot.exactTime) || "12:00 AM"}
                      </span>
                    </div>
                  </div>
                )}

                {slot.timeType === "window" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground font-medium">
                        Start Time
                      </Label>
                      <Input
                        type="time"
                        value={slot.startTime}
                        onChange={(e) =>
                          handleUpdateSlot(slot.id, "startTime", e.target.value)
                        }
                        className="h-9 text-xs"
                      />
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {format12Hour(slot.startTime)}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground font-medium">
                        End Time
                      </Label>
                      <Input
                        type="time"
                        value={slot.endTime}
                        onChange={(e) =>
                          handleUpdateSlot(slot.id, "endTime", e.target.value)
                        }
                        className="h-9 text-xs"
                      />
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {format12Hour(slot.endTime)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddSlot}
              className="w-full h-8 text-xs flex items-center justify-center gap-1.5 border-dashed border-border hover:border-primary/50 text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Another Date & Time Option
            </Button>
          </div>

          <DialogFooter className="px-6 py-3.5 border-t border-border/40 bg-muted/10 flex items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              className="text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirm}
              disabled={!slots.some((s) => s.date !== undefined)}
              className="text-xs h-8 gap-1.5 font-semibold"
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

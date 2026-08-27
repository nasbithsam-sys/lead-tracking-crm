import * as React from "react";
import { format, addDays, startOfWeek, endOfWeek, addWeeks, startOfMonth, endOfMonth } from "date-fns";
import { Calendar as CalendarIcon, X } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ScheduleDateFilterProps {
  date: DateRange | undefined;
  setDate: (date: DateRange | undefined) => void;
}

export function ScheduleDateFilter({ date, setDate }: ScheduleDateFilterProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  const presets = [
    {
      label: "Next 2 Days",
      getValue: () => ({
        from: new Date(),
        to: addDays(new Date(), 2),
      }),
    },
    {
      label: "Next Week",
      getValue: () => {
        const nextWeek = addWeeks(new Date(), 1);
        return {
          from: startOfWeek(nextWeek),
          to: endOfWeek(nextWeek),
        };
      },
    },
    {
      label: "This Month",
      getValue: () => ({
        from: startOfMonth(new Date()),
        to: endOfMonth(new Date()),
      }),
    },
  ];

  return (
    <div className="flex items-center gap-2">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "h-11 w-full justify-start text-left font-normal sm:w-[240px] rounded-[18px] border-border/70 bg-transparent shadow-[0_18px_28px_-22px_rgba(56,189,248,0.2)]",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, "LLL dd, y")} -{" "}
                  {format(date.to, "LLL dd, y")}
                </>
              ) : (
                format(date.from, "LLL dd, y")
              )
            ) : (
              <span>Filter by Schedule...</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="flex border-b border-border/50 p-2 gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.label}
                variant="secondary"
                size="sm"
                className="text-xs flex-1"
                onClick={() => {
                  setDate(preset.getValue());
                  setIsOpen(false);
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            onSelect={(d) => {
               setDate(d);
            }}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
      {date?.from && (
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-full"
          onClick={() => setDate(undefined)}
          title="Clear schedule filter"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </Button>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { addDays, todayStr } from "@/lib/format";
import CashHandoverTable from "@/components/CashHandoverTable";

export default function CashHandoverPage() {
  const [date, setDate] = useState(todayStr());
  const [startDate, setStartDate] = useState<string | null>(null);
  const isToday = date === todayStr();

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-[26px] font-semibold tracking-tight text-navy md:text-[32px]">Cash Handover</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDate(addDays(date, -1))}
            disabled={!!startDate && date <= startDate}
            className="touch-target rounded-lg border border-line px-3 text-sm hover:border-brass disabled:opacity-40"
            aria-label="Previous day"
          >
            ‹
          </button>
          <input
            type="date"
            value={date}
            min={startDate ?? undefined}
            max={todayStr()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
          />
          <button
            onClick={() => setDate(addDays(date, 1))}
            disabled={isToday}
            className="touch-target rounded-lg border border-line px-3 text-sm hover:border-brass disabled:opacity-40"
            aria-label="Next day"
          >
            ›
          </button>
          {!isToday && (
            <button onClick={() => setDate(todayStr())} className="rounded-lg border border-line px-3 py-2 text-xs uppercase tracking-wide hover:border-brass">
              Today
            </button>
          )}
        </div>
      </div>
      <CashHandoverTable date={date} onDateChange={setDate} onStartDate={setStartDate} />
    </div>
  );
}

"use client";

import "./ChartSetup";
import { Doughnut } from "react-chartjs-2";
import { Summary } from "@/types";

export default function StatusDoughnut({ summary }: { summary: Summary }) {
  return (
    <Doughnut
      data={{
        labels: ["Delivered", "Pending", "Transfer", "Cancelled"],
        datasets: [
          {
            data: [summary.delivered, summary.pending, summary.transferred, summary.cancelled],
            backgroundColor: ["#1E7145", "#B9760C", "#2B5AA6", "#AC3529"],
            borderWidth: 0,
          },
        ],
      }}
      options={{
        plugins: { legend: { position: "bottom", labels: { font: { family: "Inter", size: 11 } } } },
      }}
    />
  );
}

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
            backgroundColor: ["#34D399", "#F5B544", "#60A5FA", "#F87171"],
            borderWidth: 0,
            spacing: 2,
            hoverOffset: 6,
          },
        ],
      }}
      options={{
        cutout: "68%",
        plugins: {
          legend: {
            position: "bottom",
            labels: { usePointStyle: true, pointStyle: "rectRounded", padding: 16, font: { family: "Inter", size: 12 } },
          },
        },
      }}
    />
  );
}

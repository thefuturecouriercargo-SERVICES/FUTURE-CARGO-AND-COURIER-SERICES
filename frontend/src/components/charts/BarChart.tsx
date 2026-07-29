"use client";

import "./ChartSetup";
import { Bar } from "react-chartjs-2";

export default function BarChart({ labels, data, color = "#B08A34" }: { labels: string[]; data: number[]; color?: string }) {
  return (
    <Bar
      data={{ labels, datasets: [{ data, backgroundColor: color, borderRadius: 2 }] }}
      options={{
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: "#EFEBDF" } },
          x: { grid: { display: false } },
        },
      }}
    />
  );
}

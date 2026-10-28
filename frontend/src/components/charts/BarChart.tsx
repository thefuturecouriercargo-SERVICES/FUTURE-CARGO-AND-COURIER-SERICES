"use client";

import "./ChartSetup";
import { Bar } from "react-chartjs-2";

export default function BarChart({ labels, data, color = "#D4AF5A" }: { labels: string[]; data: number[]; color?: string }) {
  return (
    <Bar
      data={{ labels, datasets: [{ data, backgroundColor: color, borderRadius: 8, maxBarThickness: 56 }] }}
      options={{
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: "rgba(138,149,171,0.16)" }, border: { display: false } },
          x: { grid: { display: false } },
        },
      }}
    />
  );
}

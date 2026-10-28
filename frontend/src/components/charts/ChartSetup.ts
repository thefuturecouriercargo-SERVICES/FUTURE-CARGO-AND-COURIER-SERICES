import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, LineElement, PointElement, Legend, Tooltip);

// Midnight Gold defaults — muted labels and gridlines that sit quietly on the
// dark admin surfaces.
ChartJS.defaults.color = "#8A95AB"; // readable on both the dark admin and the light driver portal
ChartJS.defaults.borderColor = "rgba(138,149,171,0.16)";
ChartJS.defaults.font.family = "Inter, sans-serif";
ChartJS.defaults.plugins.tooltip.backgroundColor = "#0A1020";
ChartJS.defaults.plugins.tooltip.borderColor = "#3A3220";
ChartJS.defaults.plugins.tooltip.borderWidth = 1;
ChartJS.defaults.plugins.tooltip.titleColor = "#F1D9A0";
ChartJS.defaults.plugins.tooltip.bodyColor = "#E8ECF4";
ChartJS.defaults.plugins.tooltip.padding = 10;
ChartJS.defaults.plugins.tooltip.cornerRadius = 10;

export { ChartJS };

import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        display: ["'Fraunces'", "serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
        sans: ["'Inter'", "sans-serif"],
      },
      colors: {
        navy: { DEFAULT: "#141F33", 2: "#1E2E4C" },
        paper: { DEFAULT: "#F4F1E8", 2: "#ECE7D8" },
        ink: { DEFAULT: "#1B1B18", soft: "#5B5A52" },
        line: "#D9D2BC",
        brass: { DEFAULT: "#B08A34", light: "#DDC48A" },
        delivered: { DEFAULT: "#1E7145", bg: "#E4F0E7" },
        pending: { DEFAULT: "#B9760C", bg: "#FBEEDA" },
        cancelled: { DEFAULT: "#AC3529", bg: "#F7E6E3" },
        transferred: { DEFAULT: "#2B5AA6", bg: "#E4EBF7" },
      },
      borderRadius: {
        DEFAULT: "2px",
      },
    },
  },
  plugins: [],
};

export default config;

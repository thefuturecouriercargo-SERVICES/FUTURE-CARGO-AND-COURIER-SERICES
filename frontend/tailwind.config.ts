import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  // LiveFlowPanel builds these status classes from a variable.
  safelist: [
    { pattern: /^(bg|text|border)-(pending|transferred|delivered|cancelled)(-bg)?$/ },
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        display: ["'Sora'", "'Inter'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
        sans: ["'Inter'", "sans-serif"],
      },
      // Every brand colour reads from a CSS variable (see globals.css), so the
      // whole admin app can switch theme (Midnight Gold) by adding one class,
      // while print pages and labels keep the light values.
      colors: {
        navy: { DEFAULT: v("navy"), 2: v("navy-2") },
        paper: { DEFAULT: v("paper"), 2: v("paper-2") },
        ink: { DEFAULT: v("ink"), soft: v("ink-soft") },
        line: v("line"),
        brass: { DEFAULT: v("brass"), light: v("brass-light") },
        delivered: { DEFAULT: v("delivered"), bg: v("delivered-bg") },
        pending: { DEFAULT: v("pending"), bg: v("pending-bg") },
        cancelled: { DEFAULT: v("cancelled"), bg: v("cancelled-bg") },
        transferred: { DEFAULT: v("transferred"), bg: v("transferred-bg") },
      },
      borderRadius: {
        DEFAULT: "8px",
      },
    },
  },
  plugins: [],
};

export default config;

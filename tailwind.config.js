/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        paper: "rgb(var(--color-paper) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        panel: "rgb(var(--color-panel) / <alpha-value>)",
        sidebar: "rgb(var(--color-sidebar) / <alpha-value>)",
        line: "rgb(var(--color-line) / <alpha-value>)",
        moss: "rgb(var(--color-moss) / <alpha-value>)",
        copper: "rgb(var(--color-copper) / <alpha-value>)",
        lake: "rgb(var(--color-lake) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        focus: "rgb(var(--color-focus) / <alpha-value>)",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        panel: "var(--shadow-panel)",
        card: "var(--shadow-card)",
      },
    },
  },
  plugins: [],
};

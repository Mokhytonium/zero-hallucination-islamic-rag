/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "#F9F8F6",
        surface: "#FFFFFF",
        subtle: "#F2F0EC",
        hover: "#ECE9E2",
        line: "#E6E3DC",
        focus: "#B6B8AB",
        ink: "#272932",
        secondary: "#6E717D",
        muted: "#9FA3AD",
        dark: "#3C3E4A",
        green: { DEFAULT: "#2E6F5E", bg: "#EBF3F0" },
        amber: { DEFAULT: "#9A6700", bg: "#FEF7E6" },
        rose: { DEFAULT: "#A63A3A", bg: "#FDF0F0" },
        indigo: { DEFAULT: "#3B4D7A", bg: "#EEF2F9" },
      },
      fontFamily: {
        sans: ["Vazirmatn", "system-ui", "sans-serif"],
        quran: ["Amiri", "serif"],
      },
    },
  },
  plugins: [],
};
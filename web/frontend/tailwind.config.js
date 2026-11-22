/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        quran: ['Amiri', 'Traditional Arabic', 'serif'],
      },
      colors: {
        paper: '#FAF9F6',
        sidebar: '#F4F2ED',
        surface: '#FFFFFF',
        parchment: '#F6F4EE',
        hairline: '#E6E3DC',
        hairlineStrong: '#D5D1C8',
        ink: '#1A1918',
        inkSoft: '#4A4844',
        muted: '#7A7770',
        pine: '#1F5C47',
        pineSoft: '#EAF2EE',
        ochre: '#8C5A12',
        ochreSoft: '#FBF4E6',
        crimson: '#992F2F',
        crimsonSoft: '#FBF0F0',
      },
      boxShadow: {
        composer: '0 2px 12px rgba(26, 25, 24, 0.04), 0 1px 2px rgba(26, 25, 24, 0.03)',
        popover: '0 12px 32px -4px rgba(26, 25, 24, 0.14), 0 2px 6px rgba(26, 25, 24, 0.06)',
        menu: '0 10px 30px -5px rgba(26, 25, 24, 0.10), 0 2px 6px rgba(26, 25, 24, 0.04)',
        cardHover: '0 10px 26px -12px rgba(26, 25, 24, 0.16), 0 2px 6px rgba(26, 25, 24, 0.04)',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.22, 1, 0.36, 1)',
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
        soft: 'cubic-bezier(0.33, 1, 0.68, 1)',
      },
      transitionDuration: {
        DEFAULT: '200ms',
        250: '250ms',
        400: '400ms',
      }
    },
  },
  plugins: [],
}

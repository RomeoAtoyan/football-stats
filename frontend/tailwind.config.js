/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        pitch: {
          DEFAULT: '#1b4332',
          dark: '#081c15',
          light: '#2d6a4f',
          accent: '#40916c',
        },
      },
    },
  },
  plugins: [],
}

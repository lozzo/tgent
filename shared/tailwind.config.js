/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'var(--color-bg-page)',
        surface: 'var(--color-bg-surface)',
        elevated: 'var(--color-bg-elevated)',
        't-border': 'var(--color-border)',
        't-border-subtle': 'var(--color-border-subtle)',
        't-primary': 'var(--color-text-primary)',
        't-secondary': 'var(--color-text-secondary)',
        't-muted': 'var(--color-text-muted)',
      },
    },
  },
  plugins: [],
}

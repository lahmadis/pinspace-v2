/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: 'rgb(var(--color-canvas) / <alpha-value>)',
          light: 'rgb(var(--color-paper) / <alpha-value>)',
          lighter: 'rgb(var(--color-surface-muted) / <alpha-value>)',
          card: 'rgb(var(--color-paper) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'rgb(var(--color-primary) / <alpha-value>)',
          light: 'rgb(var(--color-primary-hover) / <alpha-value>)',
          dark: 'rgb(var(--color-forest) / <alpha-value>)',
          muted: 'rgb(var(--color-primary-muted) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-secondary) / <alpha-value>)',
          light: 'rgb(var(--color-secondary-hover) / <alpha-value>)',
          dark: 'rgb(var(--color-forest) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--color-ink) / <alpha-value>)',
          secondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted) / <alpha-value>)',
          dim: 'rgb(var(--color-text-dim) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--color-border) / <alpha-value>)',
          light: 'rgb(var(--color-border-light) / <alpha-value>)',
        },
        kova: {
          yellow: '#FFC800',
          cream: '#FFF3CC',
          paper: '#FFFCF0',
          green: '#14705C',
          forest: '#0A2F28',
          ink: '#0B0B0B',
        },
      },
      fontFamily: {
        sans: ['var(--font-figtree)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        kova: 'var(--radius-md)',
        'kova-lg': 'var(--radius-lg)',
      },
      animation: {
        'float': 'float 3s ease-in-out infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 5px rgb(255 200 0 / 0.45)' },
          '100%': { boxShadow: '0 0 20px rgb(255 200 0 / 0.75)' },
        },
      },
    },
  },
  plugins: [],
}

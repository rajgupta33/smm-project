/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Sampled from the GetFame 360 logo: deep navy wordmark ink with a
        // pink -> magenta -> blue gradient across "Fame" and the 360 arc.
        ink: {
          DEFAULT: '#0B1729',
          soft: '#33455F',
          muted: '#66788F',
          faint: '#93A2B5',
        },
        brand: {
          pink: '#E8106B',
          magenta: '#B92CB0',
          purple: '#8B3DD6',
          blue: '#2E7BE8',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          sunken: '#F5F7FB',
          raised: '#FBFCFE',
        },
        line: {
          DEFAULT: '#E3E9F2',
          strong: '#CBD5E4',
        },
        state: {
          success: '#0E9F6E',
          'success-bg': '#E6F6F0',
          warning: '#B45309',
          'warning-bg': '#FDF3E4',
          danger: '#D92D20',
          'danger-bg': '#FDECEA',
          info: '#2E7BE8',
          'info-bg': '#EAF1FD',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11, 23, 41, .05), 0 8px 24px -18px rgba(11, 23, 41, .35)',
        lift: '0 2px 6px rgba(11, 23, 41, .07), 0 18px 40px -24px rgba(11, 23, 41, .45)',
        brand: '0 8px 24px -10px rgba(185, 44, 176, .55)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(95deg, #E8106B 0%, #B92CB0 48%, #2E7BE8 100%)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideInDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleUp: {
          '0%': { transform: 'scale(0.95)' },
          '100%': { transform: 'scale(1)' },
        },
        riseIn: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 0.5s ease-out',
        slideInDown: 'slideInDown 0.4s ease-out',
        scaleUp: 'scaleUp 0.3s ease-out',
        riseIn: 'riseIn 0.35s ease-out both',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
}

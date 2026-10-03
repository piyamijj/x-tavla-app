/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts}'],
  theme: {
    extend: {
      colors: {
        oled: '#000000',
        night: '#0f172a',
        panel: '#111827',
        wood: {
          light: '#c8955c',
          DEFAULT: '#8b5a2b',
          dark: '#5c3a1a',
          deep: '#3b2410'
        },
        neon: {
          cyan: '#22d3ee',
          pink: '#f472b6',
          lime: '#a3e635',
          amber: '#fbbf24'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif']
      },
      boxShadow: {
        neon: '0 0 12px rgba(34,211,238,0.6)',
        'neon-pink': '0 0 12px rgba(244,114,182,0.6)',
        checker: 'inset 0 -3px 6px rgba(0,0,0,0.45), 0 2px 4px rgba(0,0,0,0.5)'
      },
      keyframes: {
        pulseGlow: {
          '0%,100%': { boxShadow: '0 0 4px rgba(163,230,53,0.4)' },
          '50%': { boxShadow: '0 0 16px rgba(163,230,53,0.9)' }
        }
      },
      animation: {
        glow: 'pulseGlow 1.4s ease-in-out infinite'
      }
    }
  },
  plugins: []
};

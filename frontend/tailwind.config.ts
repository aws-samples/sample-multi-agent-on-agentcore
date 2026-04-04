import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        primary: "hsl(var(--primary))",
        accent: "hsl(var(--accent))",
        border: "hsl(var(--border))",
        "agent-hr": "hsl(var(--agent-hr))",
        "agent-it": "hsl(var(--agent-it))",
        "agent-finance": "hsl(var(--agent-finance))",
        "agent-productivity": "hsl(var(--agent-productivity))",
        "agent-knowledge": "hsl(var(--agent-knowledge))",
      },
      fontFamily: {
        display: ["Outfit", "sans-serif"],
        body: ["DM Sans", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      keyframes: {
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 4px hsl(var(--primary) / 0.4)" },
          "50%": { boxShadow: "0 0 16px hsl(var(--primary) / 0.8)" },
        },
        ticker: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
      animation: {
        "slide-up": "slide-up 200ms ease-out",
        "glow-pulse": "glow-pulse 2s ease-in-out infinite",
        ticker: "ticker 30s linear infinite",
        blink: "blink 1s step-end infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;

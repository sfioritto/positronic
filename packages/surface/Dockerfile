FROM docker.io/cloudflare/sandbox:0.8.4

EXPOSE 8080

WORKDIR /workspace

# Install TypeScript, esbuild, and Tailwind CSS
RUN npm install -g typescript esbuild tailwindcss @tailwindcss/cli

# Create package.json with all runtime dependencies
COPY <<'EOF' /workspace/package.json
{
  "name": "surface-sandbox",
  "private": true,
  "type": "module",
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "radix-ui": "^1.4.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.5.0",
    "lucide-react": "^1.7.0",
    "sonner": "^2.0.7",
    "react-hook-form": "^7.54.0",
    "@hookform/resolvers": "^5.0.0",
    "zod": "^3.24.1",
    "dayjs": "^1.11.13",
    "tailwindcss": "^4.2.0",
    "jsdom": "^29.0.0",
    "@testing-library/react": "^16.0.0"
  }
}
EOF

RUN npm install

# Copy shadcn components into the sandbox so generated components can import them
COPY src/components/ /workspace/surface/components/
COPY src/lib/ /workspace/surface/lib/

# Barrel export so generated components can import from '@surface/components'
COPY <<'EOF' /workspace/surface/components/index.ts
export * from './accordion.js';
export * from './alert.js';
export * from './avatar.js';
export * from './badge.js';
export * from './button.js';
export * from './card.js';
export * from './checkbox.js';
export * from './dialog.js';
export * from './empty.js';
export * from './field.js';
export * from './form.js';
export * from './input.js';
export * from './label.js';
export * from './progress.js';
export * from './radio-group.js';
export * from './select.js';
export * from './separator.js';
export * from './skeleton.js';
export * from './slider.js';
export * from './sonner.js';
export * from './spinner.js';
export * from './switch.js';
export * from './table.js';
export * from './tabs.js';
export * from './textarea.js';
export * from './toggle.js';
export * from './toggle-group.js';
export * from './tooltip.js';
EOF

# Pre-configured tsconfig for type-checking generated components
COPY <<'EOF' /workspace/tsconfig.json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "paths": {
      "@surface/*": ["/workspace/surface/*"]
    }
  },
  "include": ["component.tsx", "types.ts", "mount.tsx", "surface/components/**/*", "surface/lib/utils.ts"]
}
EOF

# Tailwind CSS input file — imports Tailwind v4 and defines the shadcn
# neutral theme so semantic tokens (bg-primary, text-muted-foreground,
# border-input, rounded-lg, etc.) resolve to real values. Without this
# block, those utility classes produce no CSS rule at all and every
# shadcn component renders unstyled.
COPY <<'EOF' /workspace/tailwind.css
@import "tailwindcss";

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --font-heading: var(--font-sans);
}

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}
EOF

# Mount script that renders the component with data from __POSITRONIC_DATA__.
# The <Form> component reads __POSITRONIC_FORM_CONFIG__ directly for action/method/token.
# After React finishes mounting we flip `document.body.dataset.rendered = 'true'`
# so the screenshot service can wait on `body[data-rendered]` before capturing.
# Without this, Browser Rendering's networkidle0 fires while React is still
# hydrating and fullPage measures document.scrollHeight at its pre-mount value,
# clipping tall pages to the viewport size.
COPY <<'EOF' /workspace/mount.tsx
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Page from './component.tsx';

const data = (window as any).__POSITRONIC_DATA__ || {};
const root = createRoot(document.getElementById('root')!);
flushSync(() => {
  root.render(<Page data={data} />);
});

// fullPage measures scrollHeight when body[data-rendered] appears. Wait
// for fonts.ready so post-font reflow is included in that measurement.
document.fonts.ready.then(() => {
  requestAnimationFrame(() => {
    document.body.dataset.rendered = 'true';
  });
});
EOF

# Form validation script — renders the component in JSDOM and checks that
# all output schema fields have corresponding form inputs.
# Reads input data from /workspace/test-data.json and form schema from
# /workspace/form-schema.mjs (both written at runtime by validateForm).
COPY src/scripts/test-form.mjs /workspace/test-form.mjs

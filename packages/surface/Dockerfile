FROM docker.io/cloudflare/sandbox:0.8.4

EXPOSE 8080

WORKDIR /workspace

# Install TypeScript, esbuild, and testing tools
RUN npm install -g typescript esbuild

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
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "paths": {
      "@surface/*": ["/workspace/surface/*"]
    }
  },
  "include": ["*.tsx", "*.ts", "surface/**/*.tsx", "surface/**/*.ts"]
}
EOF

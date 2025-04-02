export default ({ projectName }: { projectName: string }) => (`{
  {
  "compilerOptions": {
    "allowJs": true,
    "target": "ESNext",
    "module": "ES2022",
    "lib": ["ESNext", "DOM", "WebWorker", "DOM.Iterable"],
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "incremental": true,
    "isolatedModules": true,
    "outDir": "./dist",
    "strictNullChecks": true,
    "types": ["node"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}`);
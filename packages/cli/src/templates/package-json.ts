export default ({ projectName }: { projectName: string }) => (`{
  "name": "${projectName}",
  "version": "0.1.0",
  "description": "Positronic workflow project",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "positronic development",
    "test": "echo \\"Error: no test specified\\" && exit 1"
  },
  "dependencies": {
    "@positronic/core": "latest",
    "@positronic/client-anthropic": "latest",
    "better-sqlite3": "^8.5.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "ts-node": "^10.9.1",
    "@types/node": "^20.0.0"
  }
}`);
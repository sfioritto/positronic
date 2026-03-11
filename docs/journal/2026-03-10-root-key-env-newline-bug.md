# ROOT_PUBLIC_KEY not syncing to .dev.vars in new projects

**Status:** shipped
**Started:** 2026-03-10
**Shipped:** 2026-03-10

## Goal

After the auth overhaul (commit 46ed8b4), `px project new` was supposed to fully automate root key setup so users never have to manually create JWT tokens. But running `px server` in a freshly created project produced `401 ROOT_KEY_NOT_CONFIGURED` errors on every API call. The root key was being generated and written to `.env` but never making it into `.positronic/.dev.vars` where wrangler actually reads it.

## Log

### Investigation

The auth setup flow is actually well-wired:
1. `ProjectCreate` triggers `ProjectAuthSetup` after scaffolding
2. `ProjectAuthSetup` discovers SSH keys, converts to JWK, writes `ROOT_PUBLIC_KEY` to `.env`
3. `CloudflareDevServer.setup()` calls `syncEnvironmentVariables()` which reads `.env` via `dotenv.parse()` and writes to `.dev.vars`

The generated `.env` file had `ROOT_PUBLIC_KEY` on what appeared to be line 36 — but examining the actual file content revealed it was concatenated onto the end of the previous comment line:

```
# CLOUDFLARE_ACCOUNT_ID=ROOT_PUBLIC_KEY='{"kty":"RSA",...}'
```

Since dotenv treats any line starting with `#` as a comment, the key was silently swallowed.

### Root cause

The template `_env` file ended with `# CLOUDFLARE_ACCOUNT_ID=` and no trailing newline. Node's `appendFileSync` doesn't add newlines — it appends exactly what you give it. So the ROOT_PUBLIC_KEY line (which started with `ROOT_PUBLIC_KEY=...`) got glued directly onto the comment.

## Learnings

- Template files not ending with newlines is a classic subtle bug source, especially when other code appends to them. Always ensure template files end with a newline.
- `dotenv.parse()` silently ignores anything on a comment line — no warnings, no partial parsing. If your key happens to land on a comment line, it just vanishes.
- The `appendFileSync` + "no trailing newline" combo is a footgun worth watching for anywhere files are built up incrementally.

## Solution

Two-pronged fix:
1. Added trailing newline to `packages/template-new-project/template/_env`
2. Made `project-auth-setup.tsx` defensive: before appending, it reads the existing file and prepends `\n` if the file doesn't end with one

The defensive approach in the code means this bug class can't recur even if someone later edits the template and accidentally removes the trailing newline.

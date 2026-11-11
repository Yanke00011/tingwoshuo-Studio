# Project instructions

This project is the **听我说 / Hear Me Out** publishing system, stored in two sibling Git repositories:

- Studio: `../tingwoshuo-Studio` (`Yanke00011/tingwoshuo-Studio`)
- Public Astro blog: `../tingwoshuo.github.io` (`Yanke00011/tingwoshuo.github.io`)

The Studio repository is the canonical home for cross-repository progress and planning documents. The blog repository has its own `AGENTS.md`, which points here.

## Required session start

At the start of every new Codex chat or resumed task:

1. Read `PROGRESS.md` and `ROADMAP.md` in this repository.
2. Read the relevant project docs (`README.md`, architecture/security/deployment/user guide, and the blog's `README.md`, `CONTENT_GUIDE.md`, or `DESIGN_SYSTEM.md` as applicable).
3. Check `git status`, current branch, `HEAD`, and `origin/main` in **both** repositories. Treat working-tree changes as user work until inspected; do not discard them.
4. Verify important progress claims against the current implementation and available checks. If docs disagree with code or test output, code and observed results are authoritative; correct the docs and record the discrepancy.
5. Continue from the existing implementation. Do not reimplement completed features because a new chat was opened.

## Architecture and stack

### Studio (`tingwoshuo-Studio`)

- React 19, TypeScript, Vite, Tailwind CSS 4, Tiptap/Markdown editor.
- Cloudflare Worker in `src/worker.ts` serves the app and same-origin API.
- Cloudflare Access JWT verification and write-origin/CSRF checks live in `src/security.ts` and the Worker entry.
- D1 stores private drafts, revisions, media metadata, publishing history, and rate limits. R2 stores private WebP assets.
- `src/github.ts` creates short-lived GitHub App installation tokens. `src/content.ts` validates and serializes content for the blog.
- `migrations/` owns the D1 schema. `tests/` currently contains content and security tests.

### Public blog (`tingwoshuo.github.io`)

- Astro 5 static site with TypeScript, Astro Content Collections/Zod, Tailwind CSS 4, MD/MDX, Pagefind, RSS, and sitemap generation.
- `src/content/life/` and `src/content/tech/` are the public content collections. `src/content.config.ts` is the authoritative content schema.
- `src/pages/` contains static routes; `src/components/`, `src/layouts/`, `src/lib/`, and `src/config/` separate presentation, queries, and site configuration.
- `tools/editor/` is an additional loopback-only local authoring tool. It is separate from the Cloudflare Studio Worker and is not part of the deployed site.

Studio and Astro intentionally do not share runtime code. Keep the article path, section names (`life` / `tech`), and required frontmatter compatible across `src/content.ts` and `src/content.config.ts`.

## Product and implementation constraints

- The user pushes changes and manages deployment. **Do not push, deploy, or change Cloudflare/GitHub production state** unless the user explicitly asks in that turn. Local builds and read-only status checks are allowed.
- Do not create branches. Work on the existing `main` checkout unless the user explicitly changes this preference.
- Never perform a live published-article deletion as a test. Use mocked APIs or an isolated test repository for destructive-flow verification.
- Published Studio articles are written directly to the blog's configured main branch; no release branch or PR is created by the current Studio publish path. Deletion also writes a commit. Treat both as production-affecting operations requiring explicit in-app confirmation and SHA/concurrency checks.
- Draft deletion removes the private Studio record and revisions. It does not remove an already published GitHub file. Published-file deletion removes the GitHub article and, when linked, the Studio record/history. Preserve this distinction in UI and documentation.
- Do not change the two-repository arrangement, deployment model, auth boundary, content model, or publishing strategy without discussing the architecture change with the user first.
- Do not put Access credentials, GitHub private keys, installation tokens, or other secrets in source, docs, command output, or commits. Use Cloudflare Worker Secrets.
- Keep the Studio private by default: Access is required, D1/R2 remain private, and production must fail closed when auth configuration is missing.
- Preserve Markdown/MDX source when round-trip conversion could lose data. Keep IME composition safe and avoid aggressive autosaves that interrupt Chinese input.
- Keep Chinese UI legible in both light and dark appearance; prefer the existing design tokens and component patterns.

## Development and verification

Use each repository's own lockfile and commands; do not combine the projects into one package.

Studio:

```sh
pnpm typecheck
pnpm test
pnpm build
```

Blog:

```sh
pnpm check
pnpm build
```

The blog declares Node `>=22.23.4`; use a compatible Node version. Studio's current Vite build warns on Node 20.13 even if it completes. Record exact commands, versions, and outcomes in `PROGRESS.md`; distinguish local build/test evidence from Cloudflare deployment checks.

## Documentation upkeep

- After every completed feature or meaningful fix, update `PROGRESS.md` with implementation location, verification, and remaining limits.
- Update `ROADMAP.md` when priorities, scope, dependencies, or acceptance criteria change.
- Correct relevant user/architecture/security/deployment docs when implementation changes make them stale.
- Do not mark a feature complete based only on UI presence. Verify the endpoint/data flow and report whether the live external operation was actually exercised.
- Preserve the historical separation between confirmed facts, known issues, and proposed work.

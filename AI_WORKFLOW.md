# AI Agent Workflow Guide

This document contains essential workflows and best practices for AI agents working on this project.

## ⚠️ CRITICAL: Always Commit and Push Changes

**MANDATORY RULE: After completing ANY coding task, ALWAYS commit and push to git.**

### Why This Matters
- Preserves work across AI sessions
- Creates a recoverable history of changes
- Prevents lost work if the session ends unexpectedly
- Allows team members to see progress
- Enables rollback if issues are discovered

### Standard Git Workflow

After completing ANY feature, bugfix, or documentation:

```bash
# 1. Check what changed
git status
git diff --stat

# 2. Stage relevant files (exclude local config like .claude/settings.local.json)
git add <files>

# 3. Commit with descriptive message
git commit -m "$(cat <<'EOF'
<type>: <short description>

<detailed description>

Changes:
- file1: description
- file2: description

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# 4. Push to remote
git push
```

### Commit Message Types
- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks
- `perf:` - Performance improvements
- `style:` - Code style changes (formatting, etc.)

### When to Commit

✅ **DO commit after:**
- Implementing a new feature
- Fixing a bug
- Adding or updating documentation
- Refactoring code
- Updating dependencies
- Configuration changes
- Schema or migration changes
- Any working state you'd want to preserve

❌ **DON'T commit:**
- Broken or non-compiling code
- Local configuration files (`.claude/settings.local.json`, `.env.local`, etc.)
- Work-in-progress that doesn't compile/run
- Debugging code or console.logs added for testing
- Secrets or credentials

### Pre-Commit Checklist

Before committing, verify:
- [ ] Code compiles (`npm run build` or `tsc`)
- [ ] Tests pass (if applicable)
- [ ] No secrets or credentials in code
- [ ] Local config files excluded
- [ ] Commit message is descriptive
- [ ] Changes are logically grouped

### Example Session Flow

```
User: "Add PKCE authentication flow"
AI: [Implements PKCE flow]
AI: [Runs build to verify]
AI: [Commits with descriptive message]
AI: [Pushes to git]
AI: "PKCE flow implemented and pushed to git (commit 5735496)"
```

## Project Structure

### Key Directories
```
imagine-this-printed/
├── src/
│   ├── components/     # React components
│   ├── pages/          # Page components
│   ├── context/        # React context providers
│   ├── lib/            # Utility libraries (Supabase, etc.)
│   ├── hooks/          # Custom React hooks
│   └── utils/          # Utility functions
├── backend/            # Backend server (if applicable)
├── scripts/            # Build and deployment scripts
├── docs/               # Project documentation
└── .claude/            # Claude Code configuration (local)
```

### Configuration Files
- `.env.local` - Local environment variables (DO NOT COMMIT)
- `.claude/settings.local.json` - Claude settings (DO NOT COMMIT)
- `vite.config.ts` - Vite build configuration
- `tsconfig.json` - TypeScript configuration
- `package.json` - Dependencies and scripts

## Environment Variables

### Required Variables
See `.env.example` or `docs/environment-setup.md` for complete list.

### Never Commit
- `.env.local`
- Any file containing actual API keys, secrets, or credentials

## Common Tasks

### Building the Project
```bash
npm run build
```

### Running Tests
```bash
npm test
```

### Starting Dev Server
```bash
npm run dev
```

### Checking Types
```bash
npm run type-check
# or
tsc --noEmit
```

## Authentication Implementation

The project uses **Supabase Auth with PKCE flow**. See `PKCE_SETUP.md` for complete setup.

### Key Files
- `src/lib/supabase.ts` - Supabase client configuration
- `src/context/SupabaseAuthContext.tsx` - Auth context provider
- `src/pages/AuthCallback.tsx` - OAuth callback handler

### Important Notes
- PKCE flow is enforced (no implicit flow)
- `detectSessionInUrl: false` to prevent race conditions
- Callback only accepts `?code=` parameter, not `#access_token=`

## Database Changes

### Making Schema Changes
1. Create migration file in `supabase/migrations/`
2. Test migration locally
3. Document in relevant docs
4. Commit migration file
5. Push to git
6. Apply to production via Supabase dashboard or CLI

### DO NOT
- Make ad-hoc database changes without migrations
- Hardcode IDs in migrations (they differ per environment)

## Code Style

### TypeScript
- Use TypeScript for all new code
- Avoid `any` types - use proper typing
- Enable strict mode settings

### React
- Functional components with hooks
- Use TypeScript interfaces for props
- Proper error handling in useEffect

### Logging
- Use descriptive console messages with prefixes: `[component] 🔧 message`
- Remove debug logs before committing
- Use emoji for visual categorization (🔧 init, ✅ success, ❌ error, 🔍 debug)

## Error Handling

### Best Practices
- Always handle promise rejections
- Provide user-friendly error messages
- Log errors with context
- Don't expose sensitive info in error messages

## Security

### Critical Rules
- Never commit secrets or API keys
- Use environment variables for sensitive config
- Validate user input
- Follow OWASP top 10 guidelines
- Use parameterized queries (prevent SQL injection)
- Implement proper CORS policies
- Use HTTPS in production

## Testing

### Before Pushing
1. Run build: `npm run build`
2. Check for TypeScript errors
3. Test in browser (if UI changes)
4. Verify in Incognito (for auth changes)

## Documentation

### When to Document
- New features (add to README or create docs)
- Configuration changes (update setup docs)
- API changes (update API docs)
- Breaking changes (add migration guide)

### Keep Updated
- README.md - Project overview
- Environment docs - Setup instructions
- API docs - Endpoint documentation
- This file - Workflow updates

## Troubleshooting

### Build Failures
1. Check TypeScript errors: `tsc --noEmit`
2. Clear node_modules and reinstall: `rm -rf node_modules && npm install`
3. Check for dependency conflicts

### Git Issues
- Merge conflicts: Resolve manually, test, then commit
- Diverged branches: Pull latest, rebase if needed
- Push rejected: Pull first, then push

## Session Handoff

When finishing a session, always:
1. ✅ Commit all working changes
2. ✅ Push to git
3. ✅ Document what was completed
4. ✅ Note any pending tasks or issues
5. ✅ Update relevant documentation

## Quick Reference

### Must-Do After Every Task
```bash
# The absolute minimum:
git add <changed-files>
git commit -m "feat: description of what was done"
git push
```

### Files to NEVER Commit
- `.env.local`
- `.claude/settings.local.json`
- `node_modules/`
- `dist/` or `build/`
- Any file with real API keys or secrets
- Personal IDE settings (unless agreed upon)

---

**Remember: If you made changes, commit and push them. No exceptions.**

Last updated: 2025-11-01

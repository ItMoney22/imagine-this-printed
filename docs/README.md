# ImagineThisPrinted Documentation

This directory contains all current documentation for the ImagineThisPrinted platform. Outdated and archived documentation can be found in the `archive/` subdirectory.

## Table of Contents

- [Core Documentation](#core-documentation)
- [Setup & Configuration](#setup--configuration)
- [Feature Documentation](#feature-documentation)
- [System Documentation](#system-documentation)
- [Planning Documents](#planning-documents)
- [Archived Documentation](#archived-documentation)

---

## Core Documentation

### [CLAUDE.md](../CLAUDE.md)
**Purpose:** Primary guidance file for Claude Code AI assistant
**Contains:**
- Project overview and technology stack
- Development commands and workflows
- Architecture documentation (theme system, auth flow, RBAC)
- Database schema overview
- Common development patterns and utilities
- Environment variables reference
- Path aliases and component structure

**Status:** Active - Updated regularly

### [README.md](../README.md)
**Purpose:** Main project README
**Contains:**
- Project description and features
- Quick start guide
- Tech stack overview
- Deployment information

**Status:** Active

---

## Setup & Configuration

### [ENV_VARIABLES.md](./ENV_VARIABLES.md)
**Purpose:** Complete environment variable reference
**Contains:**
- Frontend environment variables (VITE_*)
- Backend environment variables
- Supabase configuration
- Stripe configuration
- API keys and secrets
- Deployment-specific variables

**Status:** Active - Reference document

### [SUPABASE_SETUP_COMPLETE.md](./SUPABASE_SETUP_COMPLETE.md)
**Purpose:** Supabase infrastructure verification
**Contains:**
- Database schema verification
- Table structure documentation
- RLS policy verification
- Authentication setup confirmation
- Trigger and function verification

**Status:** Active - Reference document

### [TASK-5-TRIGGERS-SETUP.md](./TASK-5-TRIGGERS-SETUP.md)
**Purpose:** Database trigger configuration guide
**Contains:**
- User profile creation trigger
- Wallet creation trigger
- Trigger verification queries
- Troubleshooting guidance

**Status:** Active - Reference document

---

## Feature Documentation

### [AI_PRODUCT_BUILDER.md](./AI_PRODUCT_BUILDER.md)
**Purpose:** AI Product Builder feature documentation
**Contains:**
- Feature overview and capabilities
- Technical architecture
- API endpoints
- Implementation details
- Usage examples

**Status:** Active

### [CUSTOMER_AI_PRODUCT_BUILDER.md](./CUSTOMER_AI_PRODUCT_BUILDER.md)
**Purpose:** Customer-facing AI Product Builder documentation
**Contains:**
- User guide for AI product creation
- Feature walkthrough
- Design recommendations
- Best practices

**Status:** Active

### [WALLET_SYSTEM_COMPLETE.md](./WALLET_SYSTEM_COMPLETE.md)
**Purpose:** Comprehensive wallet system documentation
**Contains:**
- Wallet architecture and features
- Points system implementation
- ITC token integration
- Transaction handling
- API endpoints and database schema
- UI components and user flows

**Status:** Active - Complete reference

---

## System Documentation

### [RUNBOOK.md](../RUNBOOK.md)
**Purpose:** Operational runbook for system management
**Contains:**
- Deployment procedures
- Monitoring and health checks
- Troubleshooting guides
- Common maintenance tasks
- Emergency procedures

**Status:** Active

### [PRODUCTION_READINESS_CHECKLIST.md](./PRODUCTION_READINESS_CHECKLIST.md)
**Purpose:** Pre-deployment verification checklist
**Contains:**
- Infrastructure readiness checks
- Security verification
- Performance optimization
- Monitoring setup
- Backup and recovery procedures

**Status:** Active - Use before deployments

### [deployment-checklist.md](./deployment-checklist.md)
**Purpose:** Step-by-step deployment checklist
**Contains:**
- Pre-deployment tasks
- Deployment steps
- Post-deployment verification
- Rollback procedures

**Status:** Active

### [PRODUCT_SYSTEM_IMPROVEMENTS_NEEDED.md](./PRODUCT_SYSTEM_IMPROVEMENTS_NEEDED.md)
**Purpose:** Known issues and improvement backlog
**Contains:**
- Identified system issues
- Proposed improvements
- Priority levels
- Implementation considerations

**Status:** Active - Living document

### [MOCKUP_GENERATOR_PERFORMANCE.md](./MOCKUP_GENERATOR_PERFORMANCE.md)
**Purpose:** Performance analysis and optimization guide for mockup generator
**Contains:**
- Performance metrics
- Optimization strategies
- Benchmark results
- Recommendations

**Status:** Active

### [DESIGN_STUDIO_MODAL_SUMMARY.md](../DESIGN_STUDIO_MODAL_SUMMARY.md)
**Purpose:** Design Studio modal implementation summary
**Contains:**
- Modal architecture
- Component structure
- Integration points
- Usage patterns

**Status:** Active

### [DESIGN_STUDIO_QUICKSTART.md](./DESIGN_STUDIO_QUICKSTART.md)
**Purpose:** Quick start guide for Design Studio modal
**Contains:**
- 3-step integration guide
- Modal layout visualization
- Feature documentation (background removal, upscaling, mockup preview)
- Common integration points
- Pricing and ITC costs
- Developer tips and troubleshooting

**Status:** Active

---

## Planning Documents

Located in `plans/` subdirectory. These are strategic planning documents for major features and system changes.

### [2025-10-29-supabase-infrastructure-setup.md](./plans/2025-10-29-supabase-infrastructure-setup.md)
**Purpose:** Initial Supabase infrastructure planning
**Date:** October 29, 2025
**Status:** Completed

### [2025-11-04-neon-2-overhaul.md](./plans/2025-11-04-neon-2-overhaul.md)
**Purpose:** Neon 2.0 theme system overhaul planning
**Date:** November 4, 2025
**Status:** Completed (feature/neon-2-themes branch)

### [2025-11-04-ai-product-builder.md](./plans/2025-11-04-ai-product-builder.md)
**Purpose:** AI Product Builder feature planning
**Date:** November 4, 2025
**Status:** Completed

### [2025-11-06-sitewide-premium-ui-update.md](./plans/2025-11-06-sitewide-premium-ui-update.md)
**Purpose:** Sitewide premium UI update planning
**Date:** November 6, 2025
**Status:** In Progress

---

## Archived Documentation

The `archive/` subdirectory contains outdated documentation that may be useful for historical reference but is no longer current. These include:

### Task Completion Reports
- TASK_2_COMPLETION_REPORT.md
- TASK_4_IMPLEMENTATION_REPORT.md
- TASK_4_VERIFICATION_GUIDE.md
- TASK_5_VERIFICATION.md
- TASK_6_COMPLETION_REPORT.md
- TASK_6_SUMMARY.md
- TASK_9_COMPLETION_REPORT.md
- TASK-5-IMPLEMENTATION-REPORT.md
- TASK-6-IMPLEMENTATION-REPORT.md
- TASK4_SECURITY_FIXES.md

### Fix and Debug Reports
- ADMIN_FIX_INSTRUCTIONS.md
- ADMIN_ROLE_DEBUGGING.md
- CRITICAL-FIX-REPORT.md
- FIXES_SUMMARY.md
- PRODUCTION_FIXES_COMPLETED.md
- SCHEMA-DRIFT-FIXES.md
- IMAGE_MANAGEMENT_TROUBLESHOOTING.md
- IMAGE_MANAGEMENT_UI_COMPLETED.md

### Authentication Documentation (Superseded by current PKCE implementation)
- AUTH_CALLBACK_FIX_GUIDE.md
- AUTH_CALLBACK_FIX_SUMMARY.md
- AUTH_EMAIL_PASSWORD.md
- PKCE_SETUP.md
- PKCE_FIX_SUMMARY.md
- PKCE_STORAGE_KEY_UPDATE.md
- PKCE_MANUAL_STATE_PERSIST.md
- SUPABASE_AUTH_CHECKLIST.md

### Feature Implementation Docs (Completed)
- DESIGNER_IMPLEMENTATION_PLAN.md
- DESIGNER_MOCKUP_REDESIGN_PLAN.md
- MOCKUP_LIBRARY_SYSTEM.md
- MOCKUP_PREVIEW_ARCHITECTURE.md
- MOCKUP_PREVIEW_INTEGRATION.md
- MOCKUP_PREVIEW_QUICKSTART.md

### Test Reports
- CODE_REVIEW_TASK3.md
- PRODUCT_DESIGNER_TEST_REPORT.md
- PROFILE_EDIT_TEST_PLAN.md
- TESTING_SUMMARY.md

### API Test Results
- DESIGNER_API_SUMMARY.md
- DESIGNER_MOCKUP_API_TEST.md
- MOCKUPS_API_TEST_RESULTS.md

### Old Deployment Docs
- DEPLOYMENT.md
- DEPLOYMENT_STATUS.md
- RAILWAY_ENV_CHECKLIST.md
- VERCEL_ENV_SETUP.md
- setup-postgresql.md

### Other Archived Docs
- AI_WORKFLOW.md
- AI_PRODUCT_BUILDER_PROGRESS.md
- AI_PRODUCT_BUILDER_NEXT_STEPS.md
- LAUNCH-PLAN.md
- pr-description.md
- qa-report.md

---

## Documentation Standards

### File Naming Conventions
- **Active docs:** Use descriptive UPPERCASE names (e.g., `ENV_VARIABLES.md`)
- **Planning docs:** Use date prefix format `YYYY-MM-DD-description.md`
- **Feature docs:** Use descriptive names indicating the feature (e.g., `AI_PRODUCT_BUILDER.md`)

### Document Structure
All documentation should include:
1. **Title** - Clear, descriptive title
2. **Purpose** - Brief description of what the document covers
3. **Table of Contents** - For documents longer than 3 sections
4. **Sections** - Logical organization with clear headings
5. **Status** - Current status (Active, Archived, In Progress, etc.)
6. **Last Updated** - Date of last update (if applicable)

### When to Archive
Documentation should be moved to `archive/` when:
- Feature implementation is complete and documented elsewhere
- Information is superseded by newer documentation
- Bug fixes or temporary issues are resolved
- Test reports are no longer relevant
- Deployment guides are outdated

### When to Delete
Documentation should be deleted (not archived) when:
- It's a duplicate of existing documentation
- It contains no useful historical information
- It's a temporary note or scratch file
- It's been superseded multiple times

---

## Contributing to Documentation

When adding new documentation:

1. Place it in the appropriate category directory
2. Follow naming conventions
3. Include clear purpose and status
4. Update this README.md index
5. Link related documents

When updating documentation:

1. Update the "Last Updated" date
2. Maintain backward compatibility for links
3. Archive old versions if making major changes
4. Update cross-references

---

## Quick Reference

### Most Important Docs for Developers
1. [CLAUDE.md](../CLAUDE.md) - Start here for development
2. [ENV_VARIABLES.md](./ENV_VARIABLES.md) - Environment setup
3. [SUPABASE_SETUP_COMPLETE.md](./SUPABASE_SETUP_COMPLETE.md) - Database reference
4. [README.md](../README.md) - Project overview

### Most Important Docs for Deployment
1. [deployment-checklist.md](./deployment-checklist.md) - Step-by-step deployment
2. [PRODUCTION_READINESS_CHECKLIST.md](./PRODUCTION_READINESS_CHECKLIST.md) - Pre-deployment verification
3. [RUNBOOK.md](../RUNBOOK.md) - Operations guide
4. [ENV_VARIABLES.md](./ENV_VARIABLES.md) - Configuration reference

### Most Important Docs for Features
1. [WALLET_SYSTEM_COMPLETE.md](./WALLET_SYSTEM_COMPLETE.md) - Wallet system
2. [AI_PRODUCT_BUILDER.md](./AI_PRODUCT_BUILDER.md) - AI features
3. [DESIGN_STUDIO_MODAL_SUMMARY.md](../DESIGN_STUDIO_MODAL_SUMMARY.md) - Design studio
4. [plans/](./plans/) - Feature planning documents

---

## Need Help?

If you can't find what you're looking for:

1. Check the [CLAUDE.md](../CLAUDE.md) file first
2. Search the `archive/` directory for historical information
3. Check the [plans/](./plans/) directory for feature implementation details
4. Review the [README.md](../README.md) for project overview

---

**Last Updated:** November 10, 2025
**Maintained By:** Development Team
**Status:** Active

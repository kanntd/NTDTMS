# NTD TMS Project Guidelines

## Performance Is A Core Requirement

NTD TMS is used by multiple employees and multiple computers at the same time. Fast, stable interaction is a core business requirement, not an optional optimization.

- Keep save actions responsive. After a successful write, update the affected UI immediately and synchronize other data in the background.
- Do not block a completed action while reloading an entire workspace, dashboard, or master-data collection.
- Avoid duplicate refreshes. If Supabase Realtime already covers a change, do not also trigger an unconditional full refresh.
- Query only the records and columns required by the current screen. Use pagination, date limits, filters, and indexed conditions for growing tables.
- Prefer targeted cache/state updates after create, edit, delete, trip, loading, receiving, and delivery actions.
- Design database writes for concurrent use. Use atomic RPCs or database constraints with conflict-safe handling instead of read-then-insert sequences.
- Keep subscriptions scoped to relevant tables, branches, or records. Realtime events must not cause visible page flicker, lost form input, or unnecessary rerenders.
- Debounce search and filter requests where appropriate, and prevent stale responses from replacing newer state.
- Never clear an active bill form because another computer saved or edited data.
- Show immediate progress and actionable errors for network operations. Prevent accidental duplicate submissions while a write is in progress.

## Required Verification

Before deploying a workflow change:

1. Test the main workflow with realistic data volume.
2. Check concurrent use from at least two browser sessions for bill creation and other shared operations.
3. Confirm that save actions do not trigger redundant full reloads.
4. Run automated tests, TypeScript checks, and the production build.
5. For slow operations, inspect Supabase/Postgres query or RPC timing and fix the cause instead of only extending timeouts.

When implementation choices conflict, prefer the option that keeps employee workflows fast and preserves entered data under concurrent use.

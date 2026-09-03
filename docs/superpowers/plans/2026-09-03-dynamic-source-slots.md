# Dynamic Source Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy global custom-node source model with template-defined dynamic source slots, Profile-level slot bindings, slot-aware compilation, safe migration, and full visual-editor support.

**Architecture:** Template YAML is the source of truth for slot definitions under `x-wangwang.sources`. Profiles bind each immutable slot key to one or more existing Sources through `profile_source_bindings`. Compilation loads all slot-bound nodes, builds one global proxy catalog, tracks slot membership separately, expands slot placeholders per proxy group, then strips Wangwang metadata before emitting Mihomo YAML.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Hono, Cloudflare Workers, D1, Drizzle ORM, TanStack React Form, Zod, YAML, Vitest, nanoid.

**Spec:** `docs/superpowers/specs/2026-09-03-dynamic-source-slots-design.md`

## Global Constraints

- Every template must define 1–20 source slots.
- Slot keys use `^__WANGWANG_SOURCE_SLOT_[A-Za-z0-9_-]{6}__$`; user-created slots use `__WANGWANG_SOURCE_SLOT_${nanoid(6)}__`.
- Slot names are trimmed, 1–40 characters, and unique within a template.
- Every slot must be referenced by at least one proxy group.
- `__WANGWANG_CUSTOM_SOURCE_NODES__` is invalid after migration; new runtime code must not read or write `profile_sources`.
- Every Profile slot binding must contain at least one Source and at least one enabled Source.
- A Profile may bind at most 20 distinct Sources across all slots; duplicates across slots count once.
- Deleting a Source is blocked if any slot would become unbound; disabling is blocked if any slot would have no enabled Source.
- Templates used by Profiles cannot add/remove/change slot keys; rename/reorder remains allowed.
- `needs_repair` templates do not compile; their Profiles keep serving the last successful `compiledYaml`.
- Root rendered proxies remain limited to 1000 and generated YAML to 1 MiB.
- Before every commit run `pnpm format`; commit messages use project style `type(scope): 描述`.

---

## File Map

### New files

- `worker/templates/source-slots.ts` — parse/normalize slot metadata, constants, key validation/generation helpers shared by routes/validator/renderer/migration.
- `worker/profile-source-bindings.ts` — validate/read/write Profile slot bindings and query binding completeness.
- `worker/migrations/source-slot-migration.ts` — one-time semantic migration helper for built-in/custom templates and legacy Profile relations.
- `src/features/templates/visual/source-slots/source-slot-panel.tsx` — visual slot list and add/rename/delete interactions.
- `src/features/templates/visual/source-slots/source-slot-dialog.tsx` — create/rename dialog.
- `src/features/templates/visual/source-slots/index.ts` — exports.
- `tests/source-slots.test.ts` — backend template metadata/validator/renderer tests.
- `tests/profile-source-bindings.test.ts` — binding validation and source lifecycle pure/helper tests where possible.
- `tests/source-slot-migration.test.ts` — migration transformation tests.

### Main modified files

- `worker/db.ts`
- generated `drizzle/0002_*.sql` and `drizzle/meta/*`
- `worker/templates/validator.ts`
- `worker/templates/renderer.ts`
- `worker/templates/resolver.ts`
- `worker/templates/builtin.ts`
- `worker/routes/templates.ts`
- `worker/routes/profiles.ts`
- `worker/routes/sources.ts`
- `worker/tasks.ts`
- `src/api/types.ts`
- `src/features/templates/visual/model.ts`
- `src/features/templates/visual/yaml-adapter.ts`
- `src/features/templates/visual/validation.ts`
- `src/features/templates/visual/visual-editor.tsx`
- `src/features/templates/visual/groups/member-editor.tsx`
- `src/features/templates/visual/groups/group-dialog.tsx` if prop plumbing is required
- `src/features/templates/editor.tsx`
- `src/features/templates/template-preview.tsx`
- `src/features/profiles/profile-dialog.tsx`
- `src/styles/templates.css`
- `src/styles/profile-dialog.css`
- existing tests affected by `VisualTemplateDraft.sourceSlots`

---

### Task 1: Introduce Source Slot domain model and template validation

**Files:**

- Create: `worker/templates/source-slots.ts`
- Modify: `worker/templates/validator.ts`
- Modify: `worker/templates/builtin.ts`
- Test: `tests/source-slots.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export const SOURCE_SLOT_KEY_PATTERN: RegExp
  export const MAX_SOURCE_SLOTS = 20
  export type TemplateSourceSlot = { key: string; name: string }
  export function parseTemplateSourceSlots(config: Record<string, unknown>): TemplateSourceSlot[]
  export function generateSourceSlotKey(existingKeys?: Iterable<string>): string
  export function sourceSlotKeySet(config: Record<string, unknown>): Set<string>
  ```
- `parseTemplateYaml()` returns validated config that includes valid `x-wangwang.sources` metadata.

- [ ] **Step 1: Write failing slot-validation tests**

Create `tests/source-slots.test.ts` with cases for: zero slots, >20 slots, invalid key, duplicate key, duplicate trimmed name, undeclared proxy-group slot reference, declared but unused slot, legacy placeholder, unknown `__WANGWANG_*__`, and valid multi-slot template.

Use a fixture like:

```ts
const slotA = '__WANGWANG_SOURCE_SLOT_a8f3k2__'

function yamlWith(slots: string, proxies: string) {
  return `x-wangwang:\n  sources:\n${slots}\nproxy-groups:\n  - name: test\n    type: select\n    proxies:\n${proxies}\nrules:\n  - MATCH,test\n`
}
```

Assert `parseTemplateYaml()` throws exact human-readable errors for invalid cases and succeeds for the valid case.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm test -- tests/source-slots.test.ts
```

Expected: FAIL because source-slot parsing/validation does not exist and the legacy placeholder is still accepted.

- [ ] **Step 3: Implement `source-slots.ts`**

Implement strict parsing for:

```yaml
x-wangwang:
  sources:
    - key: __WANGWANG_SOURCE_SLOT_a8f3k2__
      name: 主力节点
```

Rules:

```ts
const SOURCE_SLOT_KEY_PATTERN = /^__WANGWANG_SOURCE_SLOT_[A-Za-z0-9_-]{6}__$/
const MAX_SOURCE_SLOTS = 20
```

Reject absent/empty sources, unknown `x-wangwang` fields, malformed source entries, name length >40, duplicate trimmed names, duplicate keys, and invalid key format.

`generateSourceSlotKey()` must use `nanoid(6)` and retry while `existingKeys` contains the generated key.

- [ ] **Step 4: Replace validator placeholder logic**

In `worker/templates/validator.ts`:

- Remove `CUSTOM_SOURCE_NODES_PLACEHOLDER`.
- Call `parseTemplateSourceSlots(config)` during template validation.
- Permit only declared slot keys inside `proxy-groups[].proxies`.
- Reject `__WANGWANG_CUSTOM_SOURCE_NODES__` and any undeclared/unknown `__WANGWANG_*__` string.
- Count references per slot and reject any declared slot with zero references.
- Keep rendered validation strict: no internal placeholder may survive rendering.

- [ ] **Step 5: Convert built-in templates to fixed new slot metadata**

Give each built-in template one stable slot key using a six-character suffix, for example:

```yaml
x-wangwang:
  sources:
    - key: __WANGWANG_SOURCE_SLOT_main01__
      name: 默认节点源
```

Replace every built-in legacy placeholder with that template’s fixed key. Ensure each suffix is exactly six allowed characters.

- [ ] **Step 6: Run focused tests**

```bash
pnpm test -- tests/source-slots.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run full tests and format**

```bash
pnpm test
pnpm format
pnpm format:check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add worker/templates/source-slots.ts worker/templates/validator.ts worker/templates/builtin.ts tests/source-slots.test.ts
git commit -m "feat(templates): add dynamic source slot validation"
```

---

### Task 2: Add database schema for slot bindings and template migration state

**Files:**

- Modify: `worker/db.ts`
- Create/generated: `drizzle/0002_*.sql`
- Modify/generated: `drizzle/meta/_journal.json`
- Create/generated: next Drizzle snapshot under `drizzle/meta/`

**Interfaces:**

- Produces Drizzle tables:
  ```ts
  export const profileSourceBindings
  ```
- Adds template fields:

  ```ts
  migrationStatus: 'ready' | 'needs_repair'
  migrationError: string | null
  ```

- [ ] **Step 1: Update Drizzle schema**

Add to `templates`:

```ts
migrationStatus: text('migration_status', { enum: ['ready', 'needs_repair'] })
  .$type<'ready' | 'needs_repair'>()
  .notNull()
  .default('ready'),
migrationError: text('migration_error'),
```

Add:

```ts
export const profileSourceBindings = sqliteTable(
  'profile_source_bindings',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    slotKey: text('slot_key').notNull(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.slotKey, table.sourceId] }),
    index('profile_source_bindings_source_profile_idx').on(table.sourceId, table.profileId),
    index('profile_source_bindings_profile_slot_idx').on(table.profileId, table.slotKey),
  ],
)
```

Update `profilesRelations` to expose `sourceBindings` while retaining legacy `profileSources` only as a schema object for migration/rollback. Do not use `profileSources` in new runtime code after Task 6.

- [ ] **Step 2: Generate migration**

Run:

```bash
pnpm db:generate
```

Inspect generated SQL. It must create `profile_source_bindings` and add the two template columns without dropping `profile_sources`.

- [ ] **Step 3: Apply migration locally**

```bash
pnpm db:migrate:local
```

Expected: migration succeeds on an existing local D1 database and leaves `profile_sources` present.

- [ ] **Step 4: Type-check/build**

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add worker/db.ts drizzle
git commit -m "feat(db): add profile source slot bindings"
```

---

### Task 3: Add Profile binding validation and persistence helpers

**Files:**

- Create: `worker/profile-source-bindings.ts`
- Test: `tests/profile-source-bindings.test.ts`
- Modify: `worker/routes/profiles.ts`
- Modify: `src/api/types.ts`

**Interfaces:**

- Consumes: `TemplateSourceSlot`, `profileSourceBindings`, `sources`.
- Produces:

  ```ts
  export type ProfileSourceBindingInput = { slotKey: string; sourceIds: string[] }
  export async function validateProfileSourceBindings(
    env: Env,
    slots: TemplateSourceSlot[],
    bindings: ProfileSourceBindingInput[],
  ): Promise<ProfileSourceBindingInput[]>
  export async function readProfileSourceBindings(env: Env, profileId: string): Promise<ProfileSourceBindingInput[]>
  export async function replaceProfileSourceBindings(
    env: Env,
    profileId: string,
    bindings: ProfileSourceBindingInput[],
  ): Promise<void>
  export async function profileBindingState(
    env: Env,
    profileId: string,
    slots: TemplateSourceSlot[],
  ): Promise<{ complete: boolean; bindings: ProfileSourceBindingInput[] }>
  ```

- [ ] **Step 1: Write failing pure validation tests**

Cover:

```text
missing slot
extra slot
duplicate slot entry
empty sourceIds
nonexistent source
disabled source newly bound
slot with only disabled sources
>20 unique Sources
same Source across multiple slots counts once
valid bindings preserve template slot order
```

For database-dependent cases, extract a small pure validator over resolved Source records so unit tests do not require D1. Example internal contract:

```ts
type BindingSourceState = { id: string; enabled: boolean }
```

- [ ] **Step 2: Run test and verify failure**

```bash
pnpm test -- tests/profile-source-bindings.test.ts
```

Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement helper module**

Validation must normalize duplicate source IDs inside a slot while retaining source order, verify exactly one binding row per template slot, and calculate the global unique source count with `Set`.

`replaceProfileSourceBindings()` must delete only from `profile_source_bindings` and insert replacement rows with a D1 batch. It must never touch `profile_sources`.

- [ ] **Step 4: Update API types**

In `src/api/types.ts` add:

```ts
export type TemplateSourceSlot = { key: string; name: string }
export type TemplateMigrationStatus = 'ready' | 'needs_repair'
export type ProfileSourceBinding = { slotKey: string; sourceIds: string[] }
```

Extend `TemplateSummary` with:

```ts
sourceSlots: TemplateSourceSlot[]
migrationStatus: TemplateMigrationStatus
migrationError: string | null
```

Replace `Profile.sourceIds` with:

```ts
sourceBindings: ProfileSourceBinding[]
bindingComplete: boolean
```

- [ ] **Step 5: Convert Profile routes to `sourceBindings`**

Update Zod payloads so create requires `sourceBindings`; PATCH may omit them only when template is unchanged and existing bindings remain valid. If `templateId` changes, validate the resulting binding set against the new template before writing anything.

Before accepting a Profile create/update:

```ts
const template = await resolveTemplate(...)
if (!template) -> TEMPLATE_NOT_FOUND
if (template.migrationStatus === 'needs_repair') -> 409 TEMPLATE_MIGRATION_REQUIRED
const slots = parseTemplateSourceSlots(parseTemplateYaml(template.yaml))
const bindings = await validateProfileSourceBindings(...)
```

Do not enqueue compile if validation fails.

`profileView()` reads `profile_source_bindings`, returns `sourceBindings` grouped in template slot order, and computes `bindingComplete`.

- [ ] **Step 6: Test focused module and build**

```bash
pnpm test -- tests/profile-source-bindings.test.ts
pnpm build
```

Expected: PASS.

- [ ] **Step 7: Format and commit**

```bash
pnpm format
git add worker/profile-source-bindings.ts worker/routes/profiles.ts src/api/types.ts tests/profile-source-bindings.test.ts
git commit -m "feat(profiles): bind sources by template slot"
```

---

### Task 4: Refactor node selection and renderer to be slot-aware

**Files:**

- Modify: `worker/tasks.ts`
- Modify: `worker/templates/renderer.ts`
- Modify: `worker/routes/templates.ts`
- Test: `tests/source-slots.test.ts`

**Interfaces:**

- Replace global selection with:
  ```ts
  export type SelectedSlotNode = {
    slotKey: string
    entryId: string
    sourceId: string
    name: string
    config: ProxyConfig
  }

  export async function selectProfileSlotNodes(
    env: Env,
    profile: typeof profiles.$inferSelect,
  ): Promise<SelectedSlotNode[]>
  ```
- Renderer contract:

  ```ts
  renderMihomoConfig({
    template,
    nodes,
  }: {
    template: { yaml: string }
    nodes: SelectedSlotNode[]
  }): string
  ```

- [ ] **Step 1: Add failing renderer tests**

Extend `tests/source-slots.test.ts` with:

- one slot expands only its own nodes;
- two slots in one group expand in member order;
- same `entryId` in multiple slots creates one root proxy and can appear in multiple groups;
- same group referencing overlapping slots is stable-deduped;
- different entries with identical names become `name`, `name-2` consistently in all slots;
- `filter` and `exclude-filter` apply only to slot-expanded node names;
- a filtered group may end empty without renderer failure;
- final YAML contains neither `x-wangwang` nor any `__WANGWANG_` token.

- [ ] **Step 2: Run tests and verify failure**

```bash
pnpm test -- tests/source-slots.test.ts
```

Expected: FAIL under the old global renderer contract.

- [ ] **Step 3: Implement `selectProfileSlotNodes()`**

Replace the `profileSources` join with `profileSourceBindings` joined to `sourceEntries`, `nodeEntries`, `nodes`, and `sources`.

Select `slotKey` in the same query. Keep existing ordering by source entry position/entry creation and existing Profile tag filtering semantics.

Do not query once per slot. Query all bound entries together, load tag views in bulk, then group/dedupe in memory by `(slotKey, entryId)`.

- [ ] **Step 4: Implement global proxy catalog**

In renderer:

1. Parse and validate template slots.
2. Build first-seen ordered unique entries by `entryId`.
3. Assign final unique names using current `base`, `base-2`, `base-3` behavior.
4. Build `entryId -> finalName`.
5. Build ordered `slotKey -> finalName[]` from selected nodes.
6. Set root `config.proxies` from the unique entry catalog.

Keep 1000 proxy limit based on unique root proxies.

- [ ] **Step 5: Expand groups slot-by-slot**

For every `group.proxies` member:

```ts
if slot key:
  names = slotMembers.get(key) ?? []
  names = apply filter/exclude-filter
  append names
else:
  append literal member
```

Stable-dedupe the final member array without changing first occurrence order.

Delete `config['x-wangwang']` before `validateRenderedConfig(config)` and stringify.

- [ ] **Step 6: Update compilation and preview callers**

`compileProfile()` must:

- resolve template;
- reject `needs_repair`;
- verify Profile bindings are complete;
- call `selectProfileSlotNodes()`;
- render;
- update `compiledYaml` only after successful rendering.

`/templates/preview` without `profileId` builds distinct sample entries per template slot. With `profileId`, use `selectProfileSlotNodes()` and enforce readiness without mutating stored Profile state.

- [ ] **Step 7: Run tests/build**

```bash
pnpm test -- tests/source-slots.test.ts tests/profile-source-bindings.test.ts
pnpm build
```

Expected: PASS.

- [ ] **Step 8: Format and commit**

```bash
pnpm format
git add worker/tasks.ts worker/templates/renderer.ts worker/routes/templates.ts tests/source-slots.test.ts
git commit -m "feat(renderer): expand nodes by source slot"
```

---

### Task 5: Expose template slots, migration status, and structural locking

**Files:**

- Modify: `worker/templates/resolver.ts`
- Modify: `worker/routes/templates.ts`
- Test: `tests/source-slots.test.ts`

**Interfaces:**

- `templateView()` always returns `sourceSlots`, `migrationStatus`, `migrationError`.
- Template PATCH enforces slot-key structural lock.

- [ ] **Step 1: Add failing lifecycle helper tests**

Add tests for a helper such as:

```ts
export function sameSourceSlotStructure(oldYaml: string, nextYaml: string): boolean
```

Cases:

```text
rename only -> true
reorder only -> true
add -> false
delete -> false
change key -> false
```

- [ ] **Step 2: Implement view metadata**

`templateView()` parses slots from template YAML and returns them. Built-ins synthesize:

```ts
migrationStatus: 'ready'
migrationError: null
```

Custom templates return stored DB state.

- [ ] **Step 3: Enforce PATCH lock**

For custom templates with `profileCount > 0` and `migrationStatus === 'ready'`, compare old/new slot-key sets before updating. If changed:

```text
409 TEMPLATE_SOURCE_SLOTS_LOCKED
模板正在被配置使用，不能新增、删除或修改节点源槽位
```

For `needs_repair`, allow structural change only if new YAML fully passes new validation; successful save clears `migrationError` and sets `ready`.

If repaired Profiles still lack valid bindings, do not enqueue compile jobs for them. They keep old YAML until binding completion.

- [ ] **Step 4: Run tests/build**

```bash
pnpm test -- tests/source-slots.test.ts
pnpm build
```

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add worker/templates/resolver.ts worker/routes/templates.ts tests/source-slots.test.ts
git commit -m "feat(templates): lock source slot structure in use"
```

---

### Task 6: Protect Source delete/disable operations with slot invariants

**Files:**

- Modify: `worker/routes/sources.ts`
- Modify: `worker/tasks.ts`
- Test: `tests/profile-source-bindings.test.ts`

**Interfaces:**

- Produces helper:
  ```ts
  export async function sourceSlotUsage(
    env: Env,
    sourceId: string,
  ): Promise<Array<{ profileId: string; slotKey: string; boundCount: number; enabledCount: number }>>
  ```
- `enqueueAffectedProfiles()` reads `profile_source_bindings`, never `profile_sources`.

- [ ] **Step 1: Add failing source-integrity tests**

Test the decision helper for:

```text
delete sole bound Source -> blocked
delete one of two bound Sources -> allowed
disable sole enabled Source -> blocked
disable one of two enabled Sources -> allowed
same Source in multiple slots -> all affected slots checked
```

- [ ] **Step 2: Replace runtime relation usage**

Update:

```ts
enqueueAffectedProfiles
enqueueProfilesForEntries
source list profileCount
source delete affected profile lookup
```

All must use `profileSourceBindings` and count distinct profile IDs where required. Search the repository for `profileSources` / `profile_sources`; after this task, occurrences may exist only in schema/migration/rollback code and the migration tests.

Verification command:

```bash
rg "profileSources|profile_sources" worker src tests
```

Expected: no runtime route/task usage outside migration/schema code.

- [ ] **Step 3: Add delete guard**

Before deleting a Source, query every binding `(profileId, slotKey)` containing it and determine total bound source count for each slot. If any count is 1, return:

```text
409 SOURCE_REQUIRED_BY_SLOT
```

Include affected Profile/slot display names in the error message when practical; do not expose raw implementation-only SQL details.

- [ ] **Step 4: Add disable guard**

When PATCH changes `enabled: true -> false`, determine enabled Source count for every affected slot. If any would become zero, return `409 SOURCE_REQUIRED_BY_SLOT` and perform no update.

- [ ] **Step 5: Test/build/search**

```bash
pnpm test -- tests/profile-source-bindings.test.ts
pnpm build
rg "profileSources|profile_sources" worker src tests
```

- [ ] **Step 6: Format and commit**

```bash
pnpm format
git add worker/routes/sources.ts worker/tasks.ts tests/profile-source-bindings.test.ts
git commit -m "feat(sources): protect required slot bindings"
```

---

### Task 7: Implement visual-editor source slots and YAML round-trip

**Files:**

- Modify: `src/features/templates/visual/model.ts`
- Modify: `src/features/templates/visual/yaml-adapter.ts`
- Modify: `src/features/templates/visual/validation.ts`
- Create: `src/features/templates/visual/source-slots/source-slot-panel.tsx`
- Create: `src/features/templates/visual/source-slots/source-slot-dialog.tsx`
- Create: `src/features/templates/visual/source-slots/index.ts`
- Modify: `src/features/templates/visual/visual-editor.tsx`
- Modify: `src/features/templates/visual/groups/member-editor.tsx`
- Modify: `src/features/templates/visual/groups/group-dialog.tsx` as needed for props
- Modify: `src/features/templates/editor.tsx`
- Modify: `src/styles/templates.css`
- Modify: `tests/validation.test.ts`
- Add tests to: `tests/source-slots.test.ts` or a frontend-focused YAML adapter test file if clearer

**Interfaces:**

- `VisualTemplateDraft.sourceSlots: SourceSlotDraft[]`
- `ProxyGroupMemberDraft` includes `{ kind: 'source-slot'; slotKey: string }` and no longer includes `all-proxies`.
- `memberLabel(member, groups, sourceSlots)` resolves slot display names.

- [ ] **Step 1: Update model tests/fixtures to fail first**

Update every `VisualTemplateDraft` fixture to include `sourceSlots`. Add validation tests for:

```text
slot count 0
slot duplicate name
slot invalid key
slot unused
member references missing slot
valid source slot member
```

Run:

```bash
pnpm test -- tests/validation.test.ts
```

Expected: FAIL until model/validation support is implemented.

- [ ] **Step 2: Change visual model**

Add:

```ts
export type SourceSlotDraft = { key: string; name: string }
```

Replace `all-proxies` with `source-slot`. Extend `VisualChangeMeta.scope` with `sourceSlots` if slot reorder uses existing delayed-validation flow.

Update `memberLabel()` to accept slot list and return `未知节点源槽位` for stale references.

- [ ] **Step 3: Update YAML adapter**

`parseVisualTemplate()` must parse `x-wangwang.sources` first, then parse group members using the declared slot-key map.

`parseMember()` behavior:

```text
declared slot key -> source-slot
group name -> group
DIRECT/REJECT -> builtin
other string -> raw
```

`applyVisualTemplate()` writes `x-wangwang.sources` from `draft.sourceSlots`, and `memberValue()` serializes `source-slot.slotKey` directly.

Remove every legacy `CUSTOM_SOURCE_NODES` / `all-proxies` path.

Change `newGroup()` default members to the first available source slot when one exists; if the helper lacks slot context, require caller to pass the desired initial member instead of silently creating an invalid group.

- [ ] **Step 4: Implement visual validation**

Mirror backend slot rules in `validateVisualDraft()` and add `slotKey?: string` to `VisualIssue` if useful for focusing errors. Backend remains authoritative.

- [ ] **Step 5: Build slot panel/dialog**

UI requirements:

```text
section title: 节点源槽位
count badge
list each slot name + immutable key
add button
rename action
delete action
```

Create asks only for name and generates the key using a frontend helper with `nanoid(6)` and collision retry. Rename changes only `name`. Delete checks structured group members for references and blocks with a toast listing/referring to affected groups.

Receive a prop such as:

```ts
sourceSlotsLocked: boolean
```

When locked, disable add/delete but allow rename/reorder.

- [ ] **Step 6: Replace member picker**

`MemberEditor` accepts `sourceSlots`. Replace fixed `自定义节点源` choice with one choice per slot:

```ts
{ value: `slot:${slot.key}`, label: slot.name }
```

Multiple slot members are allowed; preserve existing DnD ordering.

- [ ] **Step 7: Wire editor lock and blank template**

Replace `blankTemplate` with a valid new-format template containing one generated or fixed valid slot and one group reference.

When editing an existing template, derive `sourceSlotsLocked` from `TemplateDetail.profileCount > 0 && migrationStatus === 'ready'` and pass it to the visual editor.

For `needs_repair`, show a visible repair warning and allow slot structural editing.

- [ ] **Step 8: Run tests/build**

```bash
pnpm test -- tests/validation.test.ts tests/source-slots.test.ts
pnpm build
```

- [ ] **Step 9: Format and commit**

```bash
pnpm format
git add src/features/templates src/styles/templates.css tests/validation.test.ts tests/source-slots.test.ts
git commit -m "feat(templates): edit source slots visually"
```

---

### Task 8: Render dynamic Profile binding controls and template switching

**Files:**

- Modify: `src/features/profiles/profile-dialog.tsx`
- Modify: `src/styles/profile-dialog.css`
- Modify: `src/features/templates/template-preview.tsx` if filtering selectable Profiles is needed

**Interfaces:**

- Form field becomes:
  ```ts
  sourceBindings: Array<{ slotKey: string; sourceIds: string[] }>
  ```
- Uses `TemplateSummary.sourceSlots` and `migrationStatus` from `/templates`.

- [ ] **Step 1: Replace default form model**

Initialize editing from `profile.sourceBindings`. For a new Profile, after the chosen template resolves, create one empty binding per `sourceSlots` entry.

Use a Zod refinement that verifies:

```text
all selected-template slot keys represented exactly once
each sourceIds non-empty
each slot has an enabled selected Source
unique Source total <= 20
```

Server validation remains authoritative.

- [ ] **Step 2: Implement template-switch preservation**

On template change:

```ts
const previous = new Map(currentBindings.map((b) => [b.slotKey, b.sourceIds]))
const next = template.sourceSlots.map((slot) => ({
  slotKey: slot.key,
  sourceIds: previous.get(slot.key) ?? [],
}))
```

This preserves identical keys, removes stale keys, and leaves new slots empty.

Templates with `migrationStatus === 'needs_repair'` must be disabled/unselectable and labeled as needing repair.

- [ ] **Step 3: Render one Source selector per slot**

Each slot section displays its name and selected count. Reuse existing checkbox-card UX where practical.

Disabled Sources:

- if not currently bound: checkbox disabled;
- if currently bound on an edited Profile: show checked/retained state with `(已禁用)` label and allow the user to remove it;
- save remains invalid until at least one enabled Source exists in that slot.

Provide per-slot “全选可用” / “清空” controls. “全选可用” excludes disabled Sources.

- [ ] **Step 4: Submit new API payload**

Send:

```json
{
  "name": "...",
  "templateId": "...",
  "sourceBindings": [{ "slotKey": "__WANGWANG_SOURCE_SLOT_a8f3k2__", "sourceIds": ["..."] }],
  "tags": [],
  "enabled": true
}
```

No `sourceIds` field remains.

- [ ] **Step 5: Manual UI acceptance**

Run:

```bash
pnpm dev
```

Verify:

```text
new Profile with multi-slot template renders all slots
empty slot prevents save
same Source can be selected in multiple slots
disabled Source cannot be newly selected
switching to same-key template preserves binding
switching to different-key template resets only unmatched slots
needs_repair template cannot be selected
```

- [ ] **Step 6: Build/format/commit**

```bash
pnpm build
pnpm format
git add src/features/profiles/profile-dialog.tsx src/styles/profile-dialog.css src/features/templates/template-preview.tsx
git commit -m "feat(profiles): configure sources per template slot"
```

---

### Task 9: Implement one-time legacy migration and continuity behavior

**Files:**

- Create: `worker/migrations/source-slot-migration.ts`
- Modify: application startup/migration invocation location identified in current Worker bootstrap
- Modify: `worker/templates/builtin.ts` if fixed keys need exported lookup
- Modify: `worker/routes/templates.ts`
- Modify: `worker/tasks.ts`
- Test: `tests/source-slot-migration.test.ts`

**Interfaces:**

- Produces pure transformer:
  ```ts
  export function migrateLegacyTemplateYaml(yaml: string, slotKey: string): { yaml: string; slot: TemplateSourceSlot }
  ```
- Produces idempotent runtime data migration entry:

  ```ts
  export async function migrateLegacySourceSlots(env: Env): Promise<void>
  ```

- [ ] **Step 1: Write failing transformation tests**

Cases:

```text
legacy template with one placeholder -> adds x-wangwang + replaces placeholder
legacy template with repeated placeholder -> replaces all
legacy template without placeholder -> throws migration-required reason
legacy template with conflicting x-wangwang -> throws
transformed YAML passes new parseTemplateYaml
```

- [ ] **Step 2: Write migration-state tests**

Model/fixture tests should verify intended DB actions:

```text
custom success copies each profile_sources relation under generated slot
built-in Profiles copy old rows under built-in fixed key
custom no-placeholder -> needs_repair + migration_error
failed migration never clears compiledYaml
legacy bindings containing only disabled Sources are copied, but affected Profile is not automatically recompiled
migration is idempotent and does not duplicate bindings
```

Where D1 integration harness is unavailable, isolate SQL/action planning into pure functions and verify generated operations; keep one local migration smoke test in the final verification task.

- [ ] **Step 3: Implement pure YAML transformer**

Use YAML parse/stringify, not text replacement alone, so only exact proxy-group placeholder values are transformed. Generate one slot key per custom template and use display name `默认节点源`.

- [ ] **Step 4: Implement database migration**

Rules:

- Built-ins: use exported fixed slot key by template ID and copy legacy relation rows.
- Custom templates containing legacy placeholder: transform YAML, validate, copy bindings, then set `ready`.
- Custom templates without placeholder or with conflicting metadata: leave YAML unchanged, set `needs_repair`, persist concrete `migration_error`.
- Never delete legacy `profile_sources`.
- Use `INSERT OR IGNORE` / equivalent to make binding copy idempotent.
- Never overwrite `compiledYaml` during migration.

- [ ] **Step 5: Gate recompilation after migration**

For migrated `ready` Profiles, enqueue compile only when every slot has at least one enabled Source. Otherwise preserve the old compiled result and surface binding incompleteness in Profile view.

For `needs_repair`, compile endpoints/jobs must fail early without mutating `compiledYaml`.

- [ ] **Step 6: Wire one-time execution safely**

Use the project’s existing Worker initialization/startup mechanism. The migration must be idempotent because multiple Worker instances may start. Do not depend on in-memory once flags.

If the application has no appropriate startup hook, add a small persisted migration marker table/key or derive completion from `templates.migration_status` + existence of new binding rows; document the chosen approach in code comments.

- [ ] **Step 7: Run migration tests/build**

```bash
pnpm test -- tests/source-slot-migration.test.ts tests/source-slots.test.ts tests/profile-source-bindings.test.ts
pnpm build
```

- [ ] **Step 8: Format and commit**

```bash
pnpm format
git add worker/migrations worker/templates/builtin.ts worker/routes/templates.ts worker/tasks.ts tests/source-slot-migration.test.ts
git commit -m "feat(migration): convert legacy source bindings"
```

---

### Task 10: Final cleanup, regression verification, and rollout readiness

**Files:**

- Modify only files revealed by verification failures.
- Do not remove `profile_sources` table in this release.

**Interfaces:**

- Final runtime has no legacy source relation or placeholder dependency.

- [ ] **Step 1: Search for forbidden legacy runtime usage**

Run:

```bash
rg "__WANGWANG_CUSTOM_SOURCE_NODES__" worker src tests
rg "profileSources|profile_sources" worker src tests
```

Expected:

- legacy placeholder appears only in migration code/tests/spec/plan;
- legacy relation appears only in `worker/db.ts`, migration code/tests, and Drizzle historical files.

If any runtime route/task/renderer/editor usage remains, remove it and add a regression test.

- [ ] **Step 2: Run complete automated checks**

```bash
pnpm test
pnpm lint
pnpm build
pnpm format
pnpm format:check
```

Expected: all PASS.

- [ ] **Step 3: Local database migration smoke test**

Using a disposable/local D1 database:

1. Start from schema containing legacy `profile_sources` data.
2. Apply new Drizzle migration.
3. Run the app/migration path.
4. Verify `profile_source_bindings` contains expected copies.
5. Verify `profile_sources` remains present and unchanged.
6. Verify migrated template YAML contains `x-wangwang.sources` and no legacy placeholder.
7. Verify a failed migration template is `needs_repair` and its Profile still serves previous `compiledYaml`.

- [ ] **Step 4: Manual end-to-end acceptance**

Run `pnpm dev` and verify:

```text
Template editor:
- create 2 slots
- cannot save unused slot
- use both in one/multiple groups
- rename slot without changing key
- cannot delete referenced slot
- used template locks add/delete/key structure

Profile dialog:
- dynamic controls follow template slots
- each slot requires an enabled Source
- same Source can appear in multiple slots
- template switching preserves only matching keys

Source page:
- delete sole binding is blocked
- disable sole enabled binding is blocked
- deleting/disabling a non-critical Source triggers affected Profile recompilation

Rendered YAML:
- root proxies contain unique definitions
- groups receive only their slot nodes
- overlapping slots are deduped per group
- filters work
- x-wangwang is absent
- no __WANGWANG_*__ remains
```

- [ ] **Step 5: Verify release packaging**

Run:

```bash
pnpm package:deploy
```

Expected: packaging succeeds with the new migration/schema files included according to the project’s deployment packaging logic.

- [ ] **Step 6: Final format and commit any verification fixes**

If Task 10 required code changes:

```bash
pnpm format
git add -A
git commit -m "fix: complete dynamic source slot rollout"
```

If no changes were required, do not create an empty commit.

---

## Deferred Follow-up

After one stable release, create a separate migration that drops `profile_sources` and removes its Drizzle schema object. Do not include that destructive cleanup in this implementation.

## Completion Criteria

The feature is complete only when all of the following are true:

- New templates cannot exist without at least one valid, referenced source slot.
- Profiles use `sourceBindings` exclusively and every slot is non-empty with at least one enabled Source.
- Runtime code performs zero reads/writes against legacy `profile_sources`.
- Renderer supports multiple slots, overlapping membership, stable group dedupe, existing filters, and globally unique proxy names.
- Template visual editor can create/rename/use slots and enforces structural locking for templates in use.
- Source delete/disable operations cannot violate slot invariants.
- Legacy templates/Profile bindings migrate safely where semantics are known; ambiguous templates become `needs_repair` without interrupting existing subscriptions.
- Final emitted Mihomo YAML contains neither `x-wangwang` nor internal placeholders.
- `pnpm test`, `pnpm lint`, `pnpm build`, and `pnpm format:check` all pass.

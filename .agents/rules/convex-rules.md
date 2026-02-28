---
trigger: always_on
---

---
description: Guidelines and best practices for building Convex projects
globs: **/*.ts,**/*.tsx,**/*.js,**/*.jsx
---

# Convex Guidelines

## Functions

### Basic Syntax
```typescript
import { query } from "./_generated/server";
import { v } from "convex/values";
export const f = query({
  args: {},
  handler: async (ctx, args) => { /* body */ },
});
```

### HTTP Endpoints (`convex/http.ts`)
```typescript
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
const http = httpRouter();
http.route({
  path: "/echo", method: "POST",
  handler: httpAction(async (ctx, req) => {
    return new Response(await req.bytes(), { status: 200 });
  }),
});
```
Endpoints register at the exact `path` specified.

### Validators
```typescript
// Array validator
args: { simpleArray: v.array(v.union(v.string(), v.number())) }

// Discriminated union schema
results: defineTable(v.union(
  v.object({ kind: v.literal("error"), errorMessage: v.string() }),
  v.object({ kind: v.literal("success"), value: v.number() }),
))
```

### Valid Convex Types

| Type | TS/JS | Validator | Notes |
|------|-------|-----------|-------|
| Id | string | `v.id(table)` | |
| Null | null | `v.null()` | Use `null`, not `undefined` |
| Int64 | bigint | `v.int64()` | -2^63 to 2^63-1 |
| Float64 | number | `v.number()` | IEEE-754 |
| Boolean | boolean | `v.boolean()` | |
| String | string | `v.string()` | UTF-8, <1MB |
| Bytes | ArrayBuffer | `v.bytes()` | <1MB |
| Array | Array | `v.array(v)` | Max 8192 items |
| Object | Object | `v.object({...})` | Max 1024 entries, no `$`/`_` prefix |
| Record | Record | `v.record(k,v)` | ASCII keys, dynamic |

### Registration
- **Public**: `query`, `mutation`, `action` — exposed to the Internet
- **Private**: `internalQuery`, `internalMutation`, `internalAction` — only callable by other Convex functions
- **Always** include argument validators for every function
- Functions without a return value implicitly return `null`
- Do NOT register functions via `api` or `internal` objects

### Calling Functions
- `ctx.runQuery` — from query, mutation, or action
- `ctx.runMutation` — from mutation or action
- `ctx.runAction` — from action only (only cross-runtime)
- Always pass a `FunctionReference`, never the function directly
- Minimize action→query/mutation calls to avoid race conditions
- Add type annotation when calling functions in the same file:
```typescript
const result: string = await ctx.runQuery(api.example.f, { name: "Bob" });
```

### Function References
- Public functions → `api` object (`convex/_generated/api.ts`)
- Private functions → `internal` object (`convex/_generated/api.ts`)
- `convex/example.ts` → `api.example.f` / `internal.example.g`
- Nested: `convex/messages/access.ts` → `api.messages.access.h`

### Pagination
```typescript
import { paginationOptsValidator } from "convex/server";
export const list = query({
  args: { paginationOpts: paginationOptsValidator, author: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("messages")
      .withIndex("by_author", (q) => q.eq("author", args.author))
      .order("desc").paginate(args.paginationOpts);
  },
});
```
`.paginate()` returns `{ page, isDone, continueCursor }`.

---

## Schema (`convex/schema.ts`)
- Import from `convex/server`
- System fields auto-added: `_id` (`v.id(table)`), `_creationTime` (`v.number()`)
- Index name must include all fields: `["field1","field2"]` → `"by_field1_and_field2"`
- Index fields must be queried in definition order; create separate indexes for different orders

---

## TypeScript
- Use `Id<'table'>` from `./_generated/dataModel` for document IDs
- `v.record(v.id('users'), v.string())` → type `Record<Id<'users'>, string>`
- Strict ID types: use `Id<'users'>` not `string`
- Use `as const` for string literals in discriminated unions
- `const array: Array<T> = [...]` / `const record: Record<K,V> = {...}`

---

## Queries
- **No `filter`** — define an index and use `withIndex`
- **No `.delete()`** — `.collect()` then loop `ctx.db.delete(row._id)`
- `.unique()` — throws if multiple matches
- Async iteration: use `for await (const row of query)`, not `.collect()`
- Default order: ascending `_creationTime`; use `.order('asc'|'desc')` to override

### Full-Text Search
```typescript
const messages = await ctx.db.query("messages")
  .withSearchIndex("search_body", (q) =>
    q.search("body", "hello hi").eq("channel", "#general"))
  .take(10);
```

---

## Mutations
- `ctx.db.replace(table, id, doc)` — full replace (throws if missing)
- `ctx.db.patch(table, id, fields)` — shallow merge (throws if missing)

---

## Actions
- Add `"use node";` at top only when using Node.js built-ins
- Never put `"use node";` in files that export queries/mutations
- `fetch()` works without `"use node";`
- No `ctx.db` in actions — no database access
```typescript
export const myAction = action({
  args: {},
  handler: async (ctx, args) => { return null; },
});
```

---

## Scheduling / Crons
- Use only `crons.interval` or `crons.cron` (not `hourly`/`daily`/`weekly`)
- Pass `FunctionReference`, never the function directly
```typescript
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval("job name", { hours: 2 }, internal.crons.myFn, {});
export default crons;
```
- Always import `internal` from `_generated/api` even within `crons.ts`

---

## File Storage
- `ctx.storage.getUrl(id)` → signed URL or `null`
- Do NOT use deprecated `ctx.storage.getMetadata` — query `_storage` system table instead:
```typescript
const metadata = await ctx.db.system.get("_storage", args.fileId);
```
- Storage items are `Blob` objects; convert to/from `Blob` as needed

---

## Example: Real-Time Chat App with AI

### Schema (`convex/schema.ts`)
```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  channels: defineTable({ name: v.string() }),
  users: defineTable({ name: v.string() }),
  messages: defineTable({
    channelId: v.id("channels"),
    authorId: v.optional(v.id("users")),
    content: v.string(),
  }).index("by_channel", ["channelId"]),
});
```

### `convex/index.ts`
```typescript
import { query, mutation, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { v } from "convex/values";
import OpenAI from "openai";
import { internal } from "./_generated/api";

export const createUser = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => ctx.db.insert("users", { name: args.name }),
});

export const createChannel = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => ctx.db.insert("channels", { name: args.name }),
});

export const listMessages = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) =>
    ctx.db.query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .order("desc").take(10),
});

export const sendMessage = mutation({
  args: { channelId: v.id("channels"), authorId: v.id("users"), content: v.string() },
  handler: async (ctx, args) => {
    if (!await ctx.db.get(args.channelId)) throw new Error("Channel not found");
    if (!await ctx.db.get(args.authorId)) throw new Error("User not found");
    await ctx.db.insert("messages", { channelId: args.channelId, authorId: args.authorId, content: args.content });
    await ctx.scheduler.runAfter(0, internal.index.generateResponse, { channelId: args.channelId });
    return null;
  },
});

const openai = new OpenAI();

export const generateResponse = internalAction({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.index.loadContext, { channelId: args.channelId });
    const response = await openai.chat.completions.create({ model: "gpt-4o", messages: context });
    const content = response.choices[0].message.content;
    if (!content) throw new Error("No content in response");
    await ctx.runMutation(internal.index.writeAgentResponse, { channelId: args.channelId, content });
    return null;
  },
});

export const loadContext = internalQuery({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const messages = await ctx.db.query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .order("desc").take(10);
    const result = [];
    for (const msg of messages) {
      if (msg.authorId) {
        const user = await ctx.db.get(msg.authorId);
        if (!user) throw new Error("User not found");
        result.push({ role: "user" as const, content: `${user.name}: ${msg.content}` });
      } else {
        result.push({ role: "assistant" as const, content: msg.content });
      }
    }
    return result;
  },
});

export const writeAgentResponse = internalMutation({
  args: { channelId: v.id("channels"), content: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", { channelId: args.channelId, content: args.content });
    return null;
  },
});
```
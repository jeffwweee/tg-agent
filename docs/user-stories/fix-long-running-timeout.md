# Bug Report: Long-Running Tasks Not Sending Telegram Reply

**Status:** ✅ Fixed
**Priority:** High
**Created:** 2026-02-16
**Severity:** Critical

---

## Problem

Despite setting `PENDING_TIMEOUT_MS=86400000` (24 hours), long-running tasks are not receiving Telegram replies.

### Observed Behavior

| Task Duration | Expected | Actual |
|---------------|----------|--------|
| 10 min 7 sec | Reply sent | ❌ No reply |
| 24 min | Reply sent | ❌ No reply |

### Expected Behavior

Tasks running under 24 hours should send a Telegram reply when complete.

---

## Investigation Needed

### Possible Causes

1. **PENDING_TIMEOUT_MS not being read correctly**
   - File: `hooks/send-to-telegram.mjs` line 42
   - Check if .env is being loaded in the hook

2. **Stop hook not being triggered**
   - Claude Code might not fire the Stop hook for very long sessions
   - Check Claude Code settings

3. **Transcript file not being updated**
   - Long sessions might not flush transcript to disk
   - Check transcript reading logic

4. **State file race condition**
   - Pending state might be cleared before hook runs
   - Check state file timing

5. **Another timeout we missed**
   - There might be another timeout value we didn't update
   - Audit all timeout values

### Files to Investigate

| File | What to Check |
|------|---------------|
| `hooks/send-to-telegram.mjs` | PENDING_TIMEOUT_MS loading, checkPending() logic |
| `src/state/files.ts` | hasPending() timeout check |
| `src/server/index.ts` | Env var parsing |
| `.env` | Actual value being used |

---

## Initial Findings

### Current Timeout Values

| Location | Variable | Value | Notes |
|----------|----------|-------|-------|
| `src/server/index.ts:28` | PENDING_TIMEOUT_MS | 86400000 | ✅ Changed to 24h |
| `hooks/send-to-telegram.mjs:42` | PENDING_TIMEOUT_MS | 86400000 | ✅ Changed to 24h |
| `src/state/files.ts:157` | hasPending(timeoutMs) | Optional param | Should use env value |

### Potential Issue: Hook Not Reading .env

The `send-to-telegram.mjs` hook reads `process.env.PENDING_TIMEOUT_MS`, but hooks run in a separate process. The .env file might not be loaded!

```javascript
// Current code in hook:
const PENDING_TIMEOUT_MS = parseInt(process.env.PENDING_TIMEOUT_MS || '86400000', 10);
```

**Problem:** If `process.env.PENDING_TIMEOUT_MS` is not set in the hook's environment, it defaults to 86400000. But if the .env is not loaded, it might still use an old cached value or fall back incorrectly.

---

## Root Cause (Found)

**Two issues were found:**

### Issue 1: .env file had wrong value
```
# .env still had old value!
PENDING_TIMEOUT_MS=600000  # 10 minutes
```

The .env file was never updated when we changed the defaults in code.

### Issue 2: Hook not loading .env properly

The `send-to-telegram.mjs` hook was not loading `PENDING_TIMEOUT_MS` from .env:
```javascript
// OLD: Only read from process.env, not .env file
const PENDING_TIMEOUT_MS = parseInt(process.env.PENDING_TIMEOUT_MS || '86400000', 10);
```

The hook only manually loaded `TELEGRAM_BOT_TOKEN` from .env, not other variables.

---

## Fix Applied

### Option 1: Load .env in Hook

```javascript
// In hooks/send-to-telegram.mjs
import { config } from 'dotenv';
config({ path: join(PROJECT_ROOT, '.env') });

const PENDING_TIMEOUT_MS = parseInt(process.env.PENDING_TIMEOUT_MS || '86400000', 10);
```

### Option 2: Write Timeout to State File

Store the timeout value in the pending state file itself:

```json
{
  "chatId": 123,
  "timestamp": 1234567890,
  "timeoutMs": 86400000
}
```

### Option 3: Remove Timeout Check Entirely

Since the user set 24h timeout, just disable the timeout check in the hook:

```javascript
// Remove timeout check - always process if pending file exists
async function checkPending() {
  const content = await safeRead(TELEGRAM_PENDING_FILE);
  return content ? JSON.parse(content) : null;
}
```

---

## Testing Plan

1. Add debug logging to hook to see actual PENDING_TIMEOUT_MS value
2. Check if .env is being loaded in hook process
3. Test with a 15+ minute task
4. Verify pending state file exists when Stop hook fires

---

## Related

- Previous fix: `PENDING_TIMEOUT_MS` changed from 10min to 24h
- Files modified: `src/server/index.ts`, `hooks/send-to-telegram.mjs`, `.env.example`

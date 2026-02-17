# User Story: Selection List Support

**Status:** 📋 Planned
**Priority:** Medium
**Created:** 2026-02-16
**Effort:** L (8-16 hours)

---

## User Story

**As a** user interacting with Claude via Telegram
**I want to** make selections from a list of options (not just approve/deny)
**So that** I can provide structured input for planning, configuration, and decision-making

---

## Background

Currently, the approval hook only supports binary choices (Approve/Deny). Claude often needs to ask users to select from multiple options, such as:

- Choosing which features to include in a sprint
- Selecting a project to work on
- Picking a technology stack option
- Choosing which files to modify

The screenshot reference shows a GitFlow planning interface with selectable options - this is the target UX.

---

## Acceptance Criteria

### Core (MVP)

- [ ] Hook script can send a question with multiple options to Telegram
- [ ] User sees options as inline keyboard buttons in Telegram
- [ ] User can select one option (single-select mode)
- [ ] Selected option is returned to Claude
- [ ] Works with existing callback query infrastructure

### Enhanced

- [ ] User can select multiple options (multi-select mode)
- [ ] Options can have descriptions/subtext
- [ ] "Type something" option for custom text input
- [ ] Visual feedback shows selected state before submit
- [ ] Submit/Cancel buttons for multi-select

---

## Technical Design

### Trigger Mechanism (Decided)

**Intercept `AskUserQuestion` tool via PreToolUse hook**

Claude Code has a built-in `AskUserQuestion` tool that allows asking questions with options. We intercept this tool in the existing PreToolUse hook infrastructure.

```
Current Flow (Tool Approval):
Claude uses Bash/Write/Edit → PreToolUse hook → Ask via Telegram → Return approve/deny

New Flow (Selection):
Claude uses AskUserQuestion → PreToolUse hook → Show options in Telegram → Return selection
```

**Advantages:**
- Uses existing PreToolUse infrastructure (no new hook type needed)
- Claude already has the AskUserQuestion tool (natural integration)
- Consistent UX with tool approval flow
- Supports both single-select and multi-select via `multiSelect` parameter

### Flow

```
Claude uses AskUserQuestion tool
         ↓
PreToolUse hook intercepts
         ↓
Send selection UI to Telegram
         ↓
User selects option OR types custom input
         ↓
Callback/text handler updates state
         ↓
Hook returns selection to Claude
```

### Components

#### 1. Modify Hook Script: `hooks/permission-request.mjs`

Add handling for `AskUserQuestion` tool:

```javascript
const toolName = hookInput?.tool_name;

if (toolName === 'AskUserQuestion') {
  const questions = hookInput.tool_input.questions;
  const multiSelect = hookInput.tool_input.multiSelect || false;

  // Build selection UI
  // Send to Telegram
  // Wait for response
  // Return selection
}
```

**Input (stdin when AskUserQuestion is used):**
```json
{
  "tool_name": "AskUserQuestion",
  "tool_input": {
    "questions": [{
      "question": "What additional stories should we add?",
      "header": "Stories",
      "options": [
        { "label": "Integration Tests", "description": "Testcontainers or H2" },
        { "label": "E2E Tests", "description": "Playwright or Cypress" }
      ],
      "multiSelect": false
    }]
  }
}
```

**Output (stdout back to Claude):**
```json
{
  "selectedIndices": [0, 2],
  "selectedLabels": ["Integration Tests", "Security Scanning"],
  "customInput": null
}
```

#### 2. State Management: `src/state/selection.ts`

```typescript
interface SelectionRequest {
  requestId: string;
  question: string;
  header?: string;
  options: SelectionOption[];
  multiSelect: boolean;
  chatId: number;
  messageId?: number;
  timestamp: number;
  status: 'pending' | 'answered' | 'awaiting_input' | 'cancelled' | 'expired';
  selectedIndices: number[];
  awaitingCustomInput: boolean;
  customInput?: string;
}

interface SelectionOption {
  index: number;
  label: string;
  description?: string;
}
```

#### 3. Telegram Selection UI: `src/telegram/selection.ts`

```typescript
// Build inline keyboard for selection
function buildSelectionKeyboard(
  requestId: string,
  options: SelectionOption[],
  selectedIndices: number[],
  multiSelect: boolean
): InlineKeyboardMarkup {
  // Single-select: Each option is a button, tapping submits
  // Multi-select: Toggle buttons + Submit/Cancel row
  // Always include "Type something" and "Cancel" options
}
```

#### 4. Callback Data Format

```
# Single-select (immediate submit)
select:{requestId}:{optionIndex}

# Multi-select (toggle, no submit)
toggle:{requestId}:{optionIndex}

# Submit multi-select
submit:{requestId}

# Cancel
cancel:{requestId}

# Custom input (triggers text input mode)
custom:{requestId}
```

### UI Mockups

#### Single-Select Mode

```
📋 What project would you like to work on?

1. tg-agent
   Telegram ↔ Claude bridge

2. nextjs-dashboard
   Admin dashboard project

3. java-api
   Spring Boot microservice

─────────────────
[Cancel]
```

Tapping any option immediately submits.

#### Multi-Select Mode

```
📋 What additional stories to add?

☑️ Integration Tests
   Testcontainers or H2

⬜ E2E Tests
   Playwright or Cypress

☑️ Security Scanning
   OWASP, Snyk, or CodeQL

─────────────────
[✓ Submit]  [✗ Cancel]
```

Tapping toggles selection. Must tap Submit to confirm.

---

## Custom Text Input ("Type something")

### Flow

```
1. User sees selection UI with "✏️ Type something" button
2. User taps button
3. Bot responds: "💬 Type your answer below..."
4. User sends text message
5. Webhook captures message as response to pending request
6. Return custom text to Claude
```

### Implementation

#### 1. Add "Type something" Button

```javascript
// In selection keyboard builder
const keyboard = [
  // ... option buttons ...
  [{ text: '✏️ Type something', callback_data: `custom:${requestId}` }],
  [{ text: '✗ Cancel', callback_data: `cancel:${requestId}` }]
];
```

#### 2. Handle "custom" Callback

When user taps "Type something":

```javascript
// In callback handler (src/server/routes/telegram.ts)
if (callbackData.startsWith('custom:')) {
  const requestId = callbackData.split(':')[1];

  // Update state to indicate waiting for text input
  await updateSelectionRequest(requestId, {
    status: 'awaiting_input',
    awaitingCustomInput: true
  });

  // Prompt user
  await client.sendMessage(chatId, '💬 Type your answer below...');
}
```

#### 3. Capture Text Response in Webhook

```javascript
// In telegram webhook handler (src/server/routes/telegram.ts)
if (message.text) {
  // Check if there's a pending request awaiting custom input
  const pendingRequest = await getPendingCustomInputRequest(chatId);

  if (pendingRequest) {
    // This text is a response to the selection request
    await updateSelectionRequest(pendingRequest.requestId, {
      status: 'answered',
      customInput: message.text
    });

    // Confirm to user
    await client.sendMessage(chatId, `✅ Received: "${message.text}"`);
    return; // Don't process as normal message
  }

  // ... normal message handling ...
}
```

### UI Example

**Initial selection UI:**
```
📋 What would you like to name this file?

[ ] default.config.ts
    Use default naming

[ ] kebab-case
    file-name.config.ts

─────────────────
[✏️ Type something]
[✗ Cancel]
```

**After tapping "Type something":**
```
Bot: 💬 Type your answer below...

User: my-custom-config.ts

Bot: ✅ Received: "my-custom-config.ts"
```

### Edge Cases for Custom Input

| Case | Handling |
|------|----------|
| User types nothing | Timeout after `SELECTION_TIMEOUT_MS` |
| User sends photo instead | Reject with "Please send text only" |
| Multiple pending requests | Only one custom input awaited per chat |
| User cancels mid-input | Clear state, return "cancelled" to Claude |
| Message too long | Truncate with warning (Telegram limit: 4096 chars) |

---

## Implementation Phases

### Phase 1: Core Single-Select (MVP)

**Files:**
- Modify `hooks/permission-request.mjs` (add AskUserQuestion handling)
- Create `src/state/selection.ts`
- Create `src/telegram/selection.ts`
- Modify `src/server/routes/telegram.ts` (add selection callback handlers)

**Scope:**
- Intercept AskUserQuestion tool
- Single selection only
- No descriptions
- Immediate submit on selection
- Cancel button

### Phase 2: Multi-Select

**Files:**
- Modify `hooks/permission-request.mjs`
- Modify `src/telegram/selection.ts`
- Modify `src/server/routes/telegram.ts`

**Scope:**
- Toggle selection state
- Submit/Cancel buttons
- Track multiple selections
- Visual emoji indicators (✅/⬜)

### Phase 3: Custom Input

**Files:**
- Modify `src/server/routes/telegram.ts` (text capture)
- Modify `src/state/selection.ts` (awaiting_input state)

**Scope:**
- "✏️ Type something" button
- Text input capture mode
- Custom input state handling
- Confirmation message

---

## Edge Cases

### Selection
- **Timeout**: What happens if user doesn't respond? (Use `SELECTION_TIMEOUT_MS`)
- **Too many options**: Telegram inline keyboard has button limits (8 per row, 100 total)
- **Long labels**: Truncate or wrap long option text
- **Long descriptions**: Truncate descriptions
- **Invalid selection**: Handle out-of-range indices
- **Concurrent requests**: Multiple pending selection requests
- **Stale requests**: User responds after timeout

### Custom Input
- **User types nothing**: Timeout after `SELECTION_TIMEOUT_MS`
- **User sends photo**: Reject with "Please send text only"
- **User sends document**: Reject with "Please send text only"
- **Multiple pending requests**: Only one custom input awaited per chat
- **User cancels mid-input**: Clear state, return "cancelled" to Claude
- **Message too long**: Truncate with warning (Telegram limit: 4096 chars)
- **User sends command** (e.g., /status): Process command, keep selection pending

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `SELECTION_TIMEOUT_MS` | Timeout for selection requests | `300000` (5 min) |
| `MAX_SELECTION_OPTIONS` | Maximum number of options | `10` |

---

## Testing

### Unit Tests

- [ ] `formatSelectionQuestion()` - Message formatting
- [ ] `buildSelectionKeyboard()` - Keyboard layout
- [ ] `parseSelectionCallback()` - Callback data parsing
- [ ] State management CRUD operations

### Integration Tests

- [ ] Hook script with mock Telegram API
- [ ] Callback handling flow
- [ ] Timeout behavior

### Manual Tests

1. Send single-select request, select option
2. Send multi-select request, select multiple, submit
3. Cancel selection
4. Timeout without responding
5. Custom text input ("Type something" flow)
6. Custom input then cancel
7. Send photo during custom input (should reject)
8. Many options (test UI limits)

---

## Dependencies

- Existing Telegram webhook infrastructure
- Existing callback query handling
- Existing state file management patterns

---

## Decisions

1. **Hook trigger mechanism**: ✅ Decided
   - Intercept `AskUserQuestion` tool via PreToolUse hook
   - Uses existing infrastructure, no new hook type needed

2. **Custom input handling**: ✅ Decided
   - "✏️ Type something" button triggers text input mode
   - Webhook captures next text message as custom response

## Open Questions

1. **Message format**: Should we use MarkdownV2 formatting for questions?

2. **Selection persistence**: Should selections be logged for audit?

3. **Edit vs. New message**: When user selects, should we edit the original message or send a new one?

---

## References

- Screenshot: GitFlow selection interface (user provided)
- Similar: `hooks/permission-request.mjs` (existing approval flow)
- Telegram Inline Keyboards: https://core.telegram.org/bots#inline-keyboards-and-on-the-fly-updating

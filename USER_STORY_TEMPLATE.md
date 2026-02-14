# User Story Template

Use this template to define new features for tg-agent.

---

## User Story

**As a** [type of user]
**I want to** [action]
**So that** [benefit/value]

---

## Story ID

`TG-[NUMBER]`

---

## Priority

- [ ] Critical (blocking/essential)
- [ ] High (important for next release)
- [ ] Medium (nice to have)
- [ ] Low (future consideration)

---

## Effort Estimate

- [ ] XS (< 2 hours)
- [ ] S (2-4 hours)
- [ ] M (4-8 hours)
- [ ] L (2-3 days)
- [ ] XL (1 week+)

---

## Acceptance Criteria

```
Given [context/precondition]
When [action]
Then [expected outcome]
```

### Criteria 1: [Title]
- [ ] Criterion description

### Criteria 2: [Title]
- [ ] Criterion description

### Criteria 3: [Title]
- [ ] Criterion description

---

## Technical Notes

### Affected Components
- [ ] `src/server/` - Server/routes
- [ ] `src/telegram/` - Bot API client
- [ ] `src/tmux/` - tmux integration
- [ ] `src/state/` - State management
- [ ] `src/scheduler/` - Cron jobs
- [ ] `hooks/` - Stop hook
- [ ] Other: ___________

### Implementation Notes
<!-- Technical details, edge cases, considerations -->

---

## Dependencies

| Dependency | Type | Status |
|------------|------|--------|
| [Task/Story ID] | Blocks/Blocked by | Pending/Done |

---

## Definition of Done

- [ ] Code implemented
- [ ] Unit tests passing
- [ ] Manual testing complete
- [ ] Documentation updated
- [ ] Code reviewed
- [ ] Merged to main

---

## Example: Typing Indicator

**As a** Telegram user
**I want to** see a typing indicator while Claude processes my message
**So that** I know my request is being handled

**Story ID**: TG-001
**Priority**: Medium
**Effort**: S

### Acceptance Criteria

```
Given I send a message to the bot
When the message is received and forwarded to Claude
Then the bot shows "typing..." indicator in Telegram
```

```
Given Claude is responding
When the response is sent to Telegram
Then the typing indicator stops
```

### Technical Notes
- Use `sendChatAction` API with `typing` action
- Start indicator when webhook receives message
- Stop indicator when Stop hook sends response
- Consider timeout (max 5 seconds per Telegram API)

---

## Quick Reference: Story Categories

| Category | Prefix | Examples |
|----------|--------|----------|
| Core Features | TG-1xx | Message handling, responses |
| Commands | TG-2xx | /status, /clear, /schedule |
| UX/Formatting | TG-3xx | Markdown, typing indicator |
| Infrastructure | TG-4xx | Logging, error handling, tests |
| Scheduling | TG-5xx | Cron jobs, scheduled reports |

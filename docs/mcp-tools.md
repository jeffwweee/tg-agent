# MCP Tools Reference

Complete reference for the tg-agent MCP tools.

## Overview

tg-agent provides 4 MCP tools for Claude Code to interact with Telegram:

| Tool | Purpose | Blocking |
|------|---------|----------|
| `telegram_poll` | Fetch pending messages | Yes (long-poll) |
| `telegram_send` | Send a message | Yes |
| `telegram_ack` | Acknowledge processed messages | Yes |
| `telegram_send_typing` | Show typing indicator | Yes |

---

## telegram_poll

Fetch pending messages from the Telegram inbox.

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `timeout` | number | No | 5000 | Long-poll timeout in milliseconds |
| `limit` | number | No | 10 | Maximum messages to return |

### Behavior

1. Long-polls Redis Streams for up to `timeout` milliseconds
2. Claims messages from the consumer group (not yet acked)
3. If multiple messages, provides `combined_context` for easy processing
4. Returns empty array if no messages within timeout

### Response Schema

```typescript
interface PollResponse {
  ok: boolean;
  count: number;
  messages: Array<{
    id: string;           // Redis stream entry ID
    chat_id: number;      // Telegram chat ID
    user_id: number;      // Telegram user ID
    text: string;         // Message text
    timestamp: number;    // Unix timestamp in ms
    combined_context?: string;  // Only if multiple messages
  }>;
}
```

### Example

**Request:**
```json
{
  "name": "telegram_poll",
  "arguments": {
    "timeout": 5000,
    "limit": 10
  }
}
```

**Response (single message):**
```json
{
  "ok": true,
  "count": 1,
  "messages": [
    {
      "id": "1708492800000-0",
      "chat_id": 123456789,
      "user_id": 987654321,
      "text": "Hello, how are you?",
      "timestamp": 1708492800000
    }
  ]
}
```

**Response (multiple messages):**
```json
{
  "ok": true,
  "count": 2,
  "messages": [
    {
      "id": "1708492800000-0",
      "chat_id": 123456789,
      "user_id": 987654321,
      "text": "What's the weather?",
      "timestamp": 1708492800000,
      "combined_context": "What's the weather?\n\n---\n\nIn Tokyo"
    },
    {
      "id": "1708492801000-0",
      "chat_id": 123456789,
      "user_id": 987654321,
      "text": "In Tokyo",
      "timestamp": 1708492801000,
      "combined_context": "What's the weather?\n\n---\n\nIn Tokyo"
    }
  ]
}
```

---

## telegram_send

Send a message to a Telegram chat.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `chat_id` | number | Yes | Telegram chat ID to send to |
| `text` | string | Yes | Message text to send |
| `parse_mode` | string | No | `MarkdownV2` or `HTML` (default: `MarkdownV2`) |

### Behavior

1. Escapes text for MarkdownV2 if `parse_mode` is `MarkdownV2`
2. Chunks message if longer than 4000 characters
3. Adds progress indicators to chunks (`[1/3]`, `[2/3]`, etc.)
4. Sends each chunk sequentially
5. Returns all message IDs from Telegram

### Response Schema

```typescript
interface SendResponse {
  ok: boolean;
  message_ids?: number[];  // Telegram message IDs
  chunks_sent?: number;    // Number of chunks sent
  error?: string;          // Only if ok is false
}
```

### Example

**Request (short message):**
```json
{
  "name": "telegram_send",
  "arguments": {
    "chat_id": 123456789,
    "text": "Hello, world!"
  }
}
```

**Response:**
```json
{
  "ok": true,
  "message_ids": [42],
  "chunks_sent": 1
}
```

**Request (long message - auto-chunked):**
```json
{
  "name": "telegram_send",
  "arguments": {
    "chat_id": 123456789,
    "text": "...5000 character message..."
  }
}
```

**Response:**
```json
{
  "ok": true,
  "message_ids": [42, 43],
  "chunks_sent": 2
}
```

### MarkdownV2 Formatting

Special characters are automatically escaped:
```
_ * [ ] ( ) ~ ` > # + - = | { } . !
```

Use code blocks to preserve formatting:
```
```code here```
```

---

## telegram_ack

Acknowledge processed messages to remove from pending queue.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `message_ids` | string[] | Yes | Array of message IDs from `telegram_poll` |

### Behavior

1. Calls `XACK` on Redis Streams for each message ID
2. Messages are removed from the pending queue
3. Returns count of successfully acknowledged messages

### Response Schema

```typescript
interface AckResponse {
  ok: boolean;
  acked: number;      // Count of acked messages
  error?: string;     // Only if ok is false
}
```

### Example

**Request:**
```json
{
  "name": "telegram_ack",
  "arguments": {
    "message_ids": ["1708492800000-0", "1708492801000-0"]
  }
}
```

**Response:**
```json
{
  "ok": true,
  "acked": 2
}
```

### Important

- Always ack messages after processing
- Unacked messages remain pending for the lease duration (12 hours)
- After lease expires, messages can be claimed by other consumers

---

## telegram_send_typing

Show typing indicator in a Telegram chat.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `chat_id` | number | Yes | Telegram chat ID |

### Behavior

1. Sends `typing` chat action to Telegram
2. Indicator shows for ~5 seconds or until a message is sent
3. Use before sending long responses

### Response Schema

```typescript
interface TypingResponse {
  ok: boolean;
  error?: string;     // Only if ok is false
}
```

### Example

**Request:**
```json
{
  "name": "telegram_send_typing",
  "arguments": {
    "chat_id": 123456789
  }
}
```

**Response:**
```json
{
  "ok": true
}
```

---

## Typical Usage Pattern

```
1. telegram_send_typing(chat_id)  // Show user you're working
2. telegram_poll(timeout, limit)  // Get messages
3. [Process messages with Claude]
4. telegram_send(chat_id, reply)  // Send response
5. telegram_ack(message_ids)      // Mark processed
6. Loop to step 1
```

## Error Handling

All tools return `ok: false` on errors:

```json
{
  "ok": false,
  "error": "chat_id must be a number"
}
```

Common errors:
- Missing required parameters
- Invalid parameter types
- Telegram API errors (rate limiting, invalid chat ID)
- Redis connection errors

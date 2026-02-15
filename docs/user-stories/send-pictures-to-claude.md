# User Story: Send Pictures to Claude

**Status:** Proposed
**Priority:** Medium
**Created:** 2026-02-15
**Effort:** M (4-8 hours)

---

## User Story

**As a** user interacting with Claude via Telegram
**I want to** send pictures/photos to Claude
**So that** I can get Claude to analyze, describe, or work with visual content

---

## Acceptance Criteria

- [ ] User can send a photo message to the Telegram bot
- [ ] Photo is received and processed by the webhook
- [ ] Photo is downloaded from Telegram servers
- [ ] Photo is saved to a temporary location accessible by Claude
- [ ] Claude receives a message with the image context (file path or reference)
- [ ] Claude can analyze and respond to the image content
- [ ] User receives Claude's response about the image in Telegram

---

## Technical Design

### Flow

```
Telegram (photo) → Webhook → Download Photo → Save to workspace → Inject to tmux → Claude
                                                                              ↓
Telegram ← Stop Hook ← Claude's response ←─────────────────────────────────────┘
```

### Implementation Steps

#### 1. Handle Photo Messages in Webhook

Update `src/server/routes/telegram.ts` to handle `message.photo`:

```typescript
// Telegram sends multiple photo sizes, get the largest one
if (message.photo && message.photo.length > 0) {
  const largestPhoto = message.photo[message.photo.length - 1];
  await handlePhotoMessage(chat.id, largestPhoto, text);
}
```

#### 2. Download Photo from Telegram

Add to `src/telegram/client.ts`:

```typescript
async getFile(fileId: string): Promise<{ file_path: string }> {
  const url = `https://api.telegram.org/bot${this.token}/getFile`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  });
  return response.json();
}

async downloadFile(filePath: string): Promise<Buffer> {
  const url = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
  const response = await fetch(url);
  return Buffer.from(await response.arrayBuffer());
}
```

#### 3. Save Photo to Workspace

Save incoming photos to a dedicated folder:

```typescript
const PHOTOS_DIR = join(WORKSPACE_DIR, 'photos');

async function savePhoto(buffer: Buffer, fileId: string): Promise<string> {
  await ensureDir(PHOTOS_DIR);
  const filename = `${fileId}.jpg`;
  const filepath = join(PHOTOS_DIR, filename);
  await writeFile(filepath, buffer);
  return filepath;
}
```

#### 4. Inject Photo Reference to Claude

When a photo is received, inject a message like:

```
User sent an image. The image is saved at: /path/to/workspace/photos/xxx.jpg
Please analyze this image.
```

Or use Claude's image analysis capability if supported via CLI.

---

## Edge Cases

- **Multiple photos**: Telegram albums send multiple messages. Consider grouping.
- **Large files**: Check file size limits, consider compression.
- **Unsupported formats**: Handle non-JPG formats (PNG, WEBP).
- **Caption text**: Combine photo with text caption if provided.
- **Cleanup**: Implement periodic cleanup of old photos.

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PHOTOS_DIR` | Directory to save incoming photos | `workspace/photos` |
| `MAX_PHOTO_SIZE` | Maximum photo size in bytes | `10MB` |
| `PHOTO_CLEANUP_AGE` | Age in hours before cleanup | `24` |

---

## Testing

1. Send single photo to bot
2. Send photo with caption
3. Send multiple photos (album)
4. Send unsupported format
5. Verify photo cleanup works

---

## Dependencies

- Telegram Bot API `getFile` and file download endpoints
- File system access for saving photos
- Claude Code ability to reference local files

---

## Questions

- Should photos be saved permanently or cleaned up after processing?
- Does Claude Code CLI support image analysis from local file paths?
- Should we support sending images back from Claude to Telegram?

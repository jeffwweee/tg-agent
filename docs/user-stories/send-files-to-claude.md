# User Story: Send Files to Claude

**Status:** 📋 Proposed
**Priority:** Medium
**Created:** 2026-02-16
**Effort:** M (4-8 hours)

---

## User Story

**As a** user interacting with Claude via Telegram
**I want to** send files (PDF, TXT, CSV, JSON, etc.) to Claude
**So that** I can have Claude process, analyze, or transform document content

---

## Acceptance Criteria

- [ ] User can send a document file to the Telegram bot
- [ ] Supported file types: PDF, TXT, CSV, JSON, MD, XML
- [ ] File is received and processed by the webhook
- [ ] File is downloaded from Telegram servers
- [ ] File is saved to a dedicated location accessible by Claude
- [ ] Claude receives a message with the file context (file path, type, size)
- [ ] Claude can read and process the file content
- [ ] User receives Claude's response about the file in Telegram
- [ ] File size limit is enforced (e.g., 20MB)
- [ ] Unsupported file types are rejected with a helpful message

---

## Technical Design

### Flow

```
Telegram (document) → Webhook → Download File → Save to workspace → Inject to tmux → Claude
                                                                                 ↓
Telegram ← Stop Hook ← Claude's response ←────────────────────────────────────────┘
```

### Implementation Steps

#### 1. Handle Document Messages in Webhook

Update `src/server/routes/telegram.ts` to handle `message.document`:

```typescript
if (message.document) {
  const doc = message.document;
  const allowedTypes = ['pdf', 'txt', 'csv', 'json', 'md', 'xml'];

  const ext = doc.file_name?.split('.').pop()?.toLowerCase();
  if (!ext || !allowedTypes.includes(ext)) {
    await sendReply(chat.id, `Unsupported file type. Allowed: ${allowedTypes.join(', ')}`);
    return;
  }

  await handleDocumentMessage(chat.id, doc, message.caption);
}
```

#### 2. Download File from Telegram

Reuse existing `getFile` and `downloadFile` methods from `src/telegram/client.ts` (already implemented for photos).

#### 3. Save File to Workspace

Create `src/telegram/document.ts`:

```typescript
const FILES_DIR = process.env.FILES_DIR || 'files';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '20971520', 10); // 20MB

export interface SavedDocument {
  filePath: string;
  fileName: string;
  fileId: string;
  mimeType: string;
  fileSize: number;
}

export async function saveDocument(doc: TelegramDocument): Promise<SavedDocument> {
  const client = getTelegramClient();

  // Check file size
  if (doc.file_size && doc.file_size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${doc.file_size} bytes (max: ${MAX_FILE_SIZE})`);
  }

  // Get file info
  const fileInfo = await client.getFile(doc.file_id);
  if (!fileInfo.file_path) {
    throw new Error('Could not get file path from Telegram');
  }

  // Download
  const buffer = await client.downloadFile(fileInfo.file_path);

  // Save with original filename (sanitized)
  const safeName = sanitizeFilename(doc.file_name || `file_${Date.now()}`);
  const filesDir = await ensureFilesDir();
  const filePath = join(filesDir, safeName);

  await writeFile(filePath, buffer);

  return {
    filePath,
    fileName: doc.file_name || 'unknown',
    fileId: doc.file_id,
    mimeType: doc.mime_type || 'application/octet-stream',
    fileSize: buffer.length,
  };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}
```

#### 4. Inject File Reference to Claude

```typescript
export function formatFileMessageForClaude(savedDoc: SavedDocument, caption?: string): string {
  let message = `User sent a file: ${savedDoc.fileName}\n`;
  message += `Path: ${savedDoc.filePath}\n`;
  message += `Type: ${savedDoc.mimeType}\n`;
  message += `Size: ${Math.round(savedDoc.fileSize / 1024)}KB\n`;
  message += 'Please process this file.';

  if (caption) {
    message += `\nCaption: ${caption}`;
  }

  return message;
}
```

---

## Supported File Types

| Extension | MIME Type | Use Case |
|-----------|-----------|----------|
| `.pdf` | `application/pdf` | Document analysis |
| `.txt` | `text/plain` | Text processing |
| `.csv` | `text/csv` | Data analysis |
| `.json` | `application/json` | Data transformation |
| `.md` | `text/markdown` | Documentation |
| `.xml` | `application/xml` | Data parsing |

---

## Edge Cases

- **Large files**: Enforce 20MB limit, inform user if exceeded
- **Unsupported types**: Reject with helpful message listing supported types
- **Multiple files**: Handle one at a time (Telegram sends separately)
- **Filename conflicts**: Append timestamp or unique ID
- **Binary files**: Only support text-based formats for now
- **Cleanup**: Implement periodic cleanup of old files

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `FILES_DIR` | Directory to save incoming files | `workspace/files` |
| `MAX_FILE_SIZE` | Maximum file size in bytes | `20MB` (20971520) |
| `ALLOWED_FILE_TYPES` | Comma-separated allowed extensions | `pdf,txt,csv,json,md,xml` |
| `FILE_CLEANUP_AGE` | Age in hours before cleanup | `24` |

---

## Testing

1. Send PDF file to bot
2. Send TXT file with caption
3. Send CSV file for data analysis
4. Send unsupported file type (e.g., .exe)
5. Send file larger than 20MB
6. Verify file cleanup works

---

## Dependencies

- Telegram Bot API `getFile` and file download endpoints (already implemented)
- File system access for saving files
- Claude Code ability to read local files

---

## Future Enhancements

- [ ] Support for image files (already done via photo handling)
- [ ] Support for code files (.js, .ts, .py, etc.)
- [ ] Support for archive files (.zip, .tar.gz)
- [ ] File preview in Telegram before processing
- [ ] Multi-file upload (albums)

---

## Related

- [Send Pictures to Claude](./send-pictures-to-claude.md) - Similar implementation for photos

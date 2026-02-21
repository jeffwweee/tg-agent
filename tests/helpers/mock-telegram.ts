/**
 * Mock Telegram API Server
 *
 * A minimal mock server for testing Telegram API interactions.
 */

import http from 'http';
import { URL } from 'url';

export interface MockMessage {
  chat_id: number;
  text: string;
  parse_mode?: string;
  message_id?: number;
}

export interface MockTelegramServer {
  port: number;
  messages: MockMessage[];
  start: () => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
  setSuccess: (success: boolean) => void;
}

export function createMockTelegramServer(): MockTelegramServer {
  let server: http.Server | null = null;
  const messages: MockMessage[] = [];
  let shouldSucceed = true;
  let messageIdCounter = 1;
  let port = 0;

  const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathParts = url.pathname.split('/');
      const method = pathParts[pathParts.length - 1];

      if (req.method === 'POST') {
        let parsedBody: Record<string, unknown> = {};
        try {
          parsedBody = JSON.parse(body) as Record<string, unknown>;
        } catch {
          // Empty body is ok for some methods
        }

        if (method === 'sendMessage') {
          const msg: MockMessage = {
            chat_id: parsedBody['chat_id'] as number,
            text: parsedBody['text'] as string,
            parse_mode: parsedBody['parse_mode'] as string | undefined,
          };

          if (shouldSucceed) {
            msg.message_id = messageIdCounter++;
            messages.push(msg);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: true,
                result: {
                  message_id: msg.message_id,
                  chat: { id: msg.chat_id },
                },
              })
            );
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: false,
                description: 'Mock error',
              })
            );
          }
          return;
        }

        if (method === 'sendChatAction') {
          if (shouldSucceed) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result: true }));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, description: 'Mock error' }));
          }
          return;
        }

        if (method === 'getMe') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              result: { id: 123, is_bot: true, first_name: 'TestBot' },
            })
          );
          return;
        }
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, description: 'Not found' }));
    });
  };

  return {
    get port() {
      return port;
    },
    get messages() {
      return messages;
    },
    async start() {
      return new Promise((resolve) => {
        server = http.createServer(handler);
        server.listen(0, () => {
          const address = server?.address();
          if (address !== null && typeof address === 'object') {
            port = address.port;
          }
          resolve();
        });
      });
    },
    async stop() {
      return new Promise((resolve, reject) => {
        if (server === null) {
          resolve();
          return;
        }
        server.close((err) => {
          if (err !== undefined) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },
    clear() {
      messages.length = 0;
      messageIdCounter = 1;
    },
    setSuccess(success: boolean) {
      shouldSucceed = success;
    },
  };
}

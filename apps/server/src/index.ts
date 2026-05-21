import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { RoomManager, type RoomManagerOptions } from './room-manager.js';
import type { ClientMessage, RoomEvent, RoomSnapshot, ServerMessage } from './types.js';

const mimeTypes = new Map<string, string>([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml']
]);

export interface ServerAppOptions extends RoomManagerOptions {
  readonly clientDistDir?: string;
}

interface SocketContext {
  roomCode: string;
  seatIndex?: number;
  sessionToken?: string;
}

interface ServerApp {
  readonly server: HttpServer;
  readonly webSocketServer: WebSocketServer;
  readonly roomManager: RoomManager;
  close(): Promise<void>;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function getRequestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', 'http://localhost');
}

function getRequestPath(url: string | undefined): string {
  try {
    return decodeURIComponent(new URL(url ?? '/', 'http://localhost').pathname);
  } catch {
    return '/';
  }
}

function getHeaderValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function getPublicBaseUrl(request: IncomingMessage): string {
  const origin = getHeaderValue(request, 'origin');
  if (origin?.startsWith('http://') || origin?.startsWith('https://')) {
    return origin;
  }

  const forwardedProto = getHeaderValue(request, 'x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = getHeaderValue(request, 'x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || getHeaderValue(request, 'host') || '127.0.0.1:8787';
  const protocol = forwardedProto || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

function claimLinkUrl(baseUrl: string, roomCode: string, seatIndex: number, token: string): string {
  return `${baseUrl}/claim?room=${encodeURIComponent(roomCode)}&seat=${seatIndex}&token=${encodeURIComponent(token)}`;
}

function tryServeClientAsset(clientDistDir: string | undefined, requestPath: string, response: ServerResponse): boolean {
  if (!clientDistDir) {
    return false;
  }

  const relativePath = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const candidate = resolve(clientDistDir, relativePath);
  const fallback = resolve(clientDistDir, 'index.html');
  const assetPath = candidate.startsWith(clientDistDir) && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : !extname(requestPath) && existsSync(fallback)
      ? fallback
      : undefined;

  if (!assetPath) {
    return false;
  }

  response.writeHead(200, {
    'Content-Type': mimeTypes.get(extname(assetPath)) ?? 'application/octet-stream'
  });
  createReadStream(assetPath).pipe(response);
  return true;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function withMessageId(message: ServerMessage, id: string | undefined): ServerMessage {
  return id === undefined ? message : { ...message, id } as ServerMessage;
}

function isClientMessage(value: unknown): value is ClientMessage {
  return typeof value === 'object' && value !== null && 'type' in value;
}

function getSocketQuery(request: IncomingMessage): URLSearchParams {
  return getRequestUrl(request).searchParams;
}

async function sendSnapshot(socket: WebSocket, roomManager: RoomManager, context: SocketContext): Promise<void> {
  const room = await roomManager.getRoom(context.roomCode);
  if (!room) {
    send(socket, { type: 'error', payload: { code: 'not_found', message: `Room ${context.roomCode} not found.` } });
    return;
  }
  const snapshot = roomManager.createSnapshot(room, context.seatIndex);
  send(socket, { type: 'snapshot', payload: snapshot });
  sendActionNotification(socket, snapshot);
}

function sendActionNotification(socket: WebSocket, snapshot: RoomSnapshot): void {
  if (snapshot.viewerSeatIndex === undefined || snapshot.legalActions.length === 0) {
    return;
  }
  send(socket, {
    type: 'action_required',
    payload: {
      roomCode: snapshot.roomCode,
      seatIndex: snapshot.viewerSeatIndex,
      version: snapshot.version,
      legalActions: snapshot.legalActions
    }
  });
}

function isSameRoom(context: SocketContext | undefined, event: RoomEvent): boolean {
  return context?.roomCode === event.roomCode;
}

export function createServerApp(options: ServerAppOptions = {}): ServerApp {
  const roomManager = new RoomManager(options);
  const sockets = new Map<WebSocket, SocketContext>();
  const clientDistDir = options.clientDistDir ? resolve(options.clientDistDir) : undefined;

  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      const url = getRequestUrl(request);
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true, service: 'hongkong-mahjong-server', rooms: (await roomManager.listRooms()).length });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/rooms') {
        const body = await readJsonBody(request) as { seed?: string };
        const result = await roomManager.createRoom(typeof body.seed === 'string' ? body.seed : undefined);
        const publicBaseUrl = getPublicBaseUrl(request);
        sendJson(response, 201, {
          room: roomManager.createSnapshot(result.room),
          claimLinks: result.claimLinks.map((link) => ({
            ...link,
            url: claimLinkUrl(publicBaseUrl, result.room.roomCode, link.seatIndex, link.token)
          }))
        });
        return;
      }

      const roomMatch = /^\/api\/rooms\/([^/]+)$/.exec(url.pathname);
      if (request.method === 'GET' && roomMatch) {
        const room = await roomManager.getRoom(roomMatch[1]!);
        if (!room) {
          sendJson(response, 404, { error: 'not_found', message: 'Room not found.' });
          return;
        }
        sendJson(response, 200, { room: roomManager.createSnapshot(room) });
        return;
      }

      const claimMatch = /^\/api\/rooms\/([^/]+)\/claim$/.exec(url.pathname);
      if (request.method === 'POST' && claimMatch) {
        const body = await readJsonBody(request) as { seatIndex?: number; token?: string; displayName?: string };
        const result = await roomManager.claimSeat(claimMatch[1]!, Number(body.seatIndex), String(body.token ?? ''), body.displayName);
        sendJson(response, 200, {
          room: roomManager.createSnapshot(result.room, Number(body.seatIndex)),
          sessionToken: result.sessionToken
        });
        return;
      }

      if (request.method === 'GET' && tryServeClientAsset(clientDistDir, getRequestPath(request.url), response)) {
        return;
      }

      sendJson(response, 200, { message: 'Hong Kong Mahjong realtime room server', endpoints: ['/health', 'POST /api/rooms', 'GET /api/rooms/:roomCode', 'POST /api/rooms/:roomCode/claim', 'WS /ws?room=ROOM'] });
    } catch (error) {
      sendJson(response, 400, { error: 'bad_request', message: error instanceof Error ? error.message : 'Request failed.' });
    }
  });

  const webSocketServer = new WebSocketServer({ server, path: '/ws' });

  roomManager.coordination.subscribe((event) => {
    for (const [socket, context] of sockets.entries()) {
      if (!isSameRoom(context, event)) {
        continue;
      }
      if (event.type !== 'room_updated') {
        send(socket, { type: 'notification', payload: event });
      }
      void sendSnapshot(socket, roomManager, context);
    }
  });

  webSocketServer.on('connection', (socket, request) => {
    void (async () => {
      try {
        const query = getSocketQuery(request);
        const requestedRoom = query.get('room');
        const seatParam = query.get('seat');
        const sessionToken = query.get('session') ?? undefined;
        const roomCode = requestedRoom ?? (await roomManager.createRoom()).room.roomCode;
        const seatIndex = seatParam === null ? undefined : Number(seatParam);
        const connection = await roomManager.connectSeat(roomCode, seatIndex, sessionToken);
        const context: SocketContext = {
          roomCode: connection.room.roomCode,
          ...(connection.viewerSeatIndex !== undefined ? { seatIndex: connection.viewerSeatIndex } : {}),
          ...(sessionToken ? { sessionToken } : {})
        };
        sockets.set(socket, context);
        setImmediate(() => {
          void sendSnapshot(socket, roomManager, context);
        });
      } catch (error) {
        send(socket, { type: 'error', payload: { code: 'connection_failed', message: error instanceof Error ? error.message : 'Connection failed.' } });
        socket.close(1008);
      }
    })();

    socket.on('message', (message) => {
      void (async () => {
        const context = sockets.get(socket);
        try {
          const parsed = JSON.parse(message.toString()) as unknown;
          if (!isClientMessage(parsed)) {
            send(socket, { type: 'error', payload: { code: 'invalid_message', message: 'Malformed client message.' } });
            return;
          }
          if (parsed.type === 'ping') {
            send(socket, withMessageId({ type: 'pong' }, parsed.id));
            return;
          }
          if (parsed.type === 'join') {
            const connection = await roomManager.connectSeat(parsed.roomCode, parsed.seatIndex, parsed.sessionToken);
            const nextContext: SocketContext = {
              roomCode: connection.room.roomCode,
              ...(connection.viewerSeatIndex !== undefined ? { seatIndex: connection.viewerSeatIndex } : {}),
              ...(parsed.sessionToken ? { sessionToken: parsed.sessionToken } : {})
            };
            sockets.set(socket, nextContext);
            await sendSnapshot(socket, roomManager, nextContext);
            return;
          }
          if (parsed.type === 'command') {
            if (!context) {
              send(socket, withMessageId({ type: 'error', payload: { code: 'not_joined', message: 'Join a room before sending commands.' } }, parsed.id));
              return;
            }
            const result = await roomManager.submitHumanAction(context.roomCode, context.seatIndex, context.sessionToken, parsed.expectedVersion, parsed.action);
            if (result.ok) {
              send(socket, withMessageId({ type: 'command_ack', payload: { roomCode: result.room.roomCode, version: result.room.version } }, parsed.id));
            } else {
              send(socket, withMessageId({ type: 'error', payload: { code: result.code, message: result.message } }, parsed.id));
            }
          }
        } catch (error) {
          send(socket, { type: 'error', payload: { code: 'invalid_message', message: error instanceof Error ? error.message : 'Message handling failed.' } });
        }
      })();
    });

    socket.on('close', () => {
      const context = sockets.get(socket);
      sockets.delete(socket);
      if (context) {
        void roomManager.disconnectSeat(context.roomCode, context.seatIndex, context.sessionToken);
      }
    });
  });

  return {
    server,
    webSocketServer,
    roomManager,
    close: () => new Promise<void>((resolve, reject) => {
      for (const socket of sockets.keys()) {
        socket.close();
      }
      webSocketServer.close((wsError) => {
        if (wsError) {
          reject(wsError);
          return;
        }
        server.close((serverError) => {
          if (serverError) {
            reject(serverError);
          } else {
            resolve();
          }
        });
      });
    })
  };
}

export function startServer(): ServerApp {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '127.0.0.1';
  const clientDistDir = process.env.CLIENT_DIST_DIR;
  const app = createServerApp(clientDistDir ? { clientDistDir } : {});
  app.server.listen(port, host, () => {
    console.log(`Hong Kong Mahjong server listening at http://${host}:${port}`);
  });
  return app;
}

const isEntrypoint = process.argv[1] ? resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]) : false;
if (isEntrypoint) {
  startServer();
}

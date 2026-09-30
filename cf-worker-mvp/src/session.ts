// SessionDO- one Durable Object per sessionId. It holds that session's WebSocket(s) and
// relays Workflow progress back to the browser.
import { DurableObject } from 'cloudflare:workers';

/**
 * Try it from the browser console (with `wrangler dev` running):
 *
 * const sessionId = crypto.randomUUID();
 * const ws = new WebSocket(`ws://127.0.0.1:8787?sessionId=${sessionId}`);
 * ws.onopen = () => ws.send('recent advances in RAG'); // -> webSocketMessage()
 * ws.onmessage = (event) => console.log('Got back:', event.data); // <- ws.send() / pushUpdate()
 */

export interface Env {
	RESEARCH_WORKFLOW: Workflow;
}

export class SessionDO extends DurableObject<Env> {
	// Reached via stub.fetch() from index.ts and completes the WebSocket upgrade handshake.
	async fetch(request: Request): Promise<Response> {
		const upgradeHeader = request.headers.get('Upgrade');

		if (upgradeHeader !== 'websocket') {
			return new Response('Expected a WebSocket upgrade request', { status: 400 });
		}

		// `server` stays here; `client` goes back to the browser in the 101 response.
		const [client, server] = Object.values(new WebSocketPair());
		/*
            const pair = webSocketPair()
            const client = pair[0]
            const server = pair[1]
        */

		// Accept (with Hibernation): the connection stays open while this DO's JS can be evicted
		// when idle. In-memory fields are lost on eviction (local variables, ect)
		// so for anything that needs to persist: this.ctx.storage.
		// (server.accept() would pin the DO in memory for as long as the socket is open.)
		this.ctx.acceptWebSocket(server);

		return new Response(null, { status: 101, webSocket: client });
	}

	// Called by the runtime when a connected socket sends a message.
	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		const query = message.toString();
		console.log('Starting research for query:', query);

		await this.env.RESEARCH_WORKFLOW.create({
			params: {
				query,
				sessionId: this.ctx.id.toString(), // lets the Workflow find its way back to this DO
			},
		});

		ws.send(`Started researching: "${query}"`);
	}

	// Called by the Workflow over RPC (sessionStub.pushUpdate(...))
	// public methods are callable through the stub
	// Broadcasts to every socket in this DO. There's more than one only if several connections used the same sessionId.
	async pushUpdate(text: string) {
		for (const ws of this.ctx.getWebSockets()) {
			ws.send(text);
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
		console.log('DO: client disconnected', code, reason);
	}
}

//session.ts - Holds the WebSocket connection and remembers data
import { DurableObject } from 'cloudflare:workers';

/*
In Browser Console:
const ws = new WebSocket("ws://127.0.0.1:8787");
^Acting as browser, initiating handshake ( GET request with Upgrade: websocket )
Request hits index.ts -> routes to stub -> stub.fetch(request) calls this DO's fetch function
-> pair is created -> this.ctx.acceptWebSocket(server) called 
-> 101 response sent back -> runtime splices client onto network 
-> ws.onopen fires
ws.onopen = () => {
    console.log("Conecteddd!");
    ws.send("helloooo~");
    ^message is sent from browser and caught by webSocketMessage function

}
ws.onmessage = (event) => console.log("Got back: ", event.data); 
^Catches the message the sever sends back from the webSocketMessage function

Splicing client onto network: client obj is joined withnetwork socket
*/

//New Browser Console Code (After not hard-coding sessionId):
/**
 * const sessionId = crypto.randomUUID();
 * console.log("My session:", sessionId);
 *
 * const ws = new WebSocket(`ws://127.0.0.1:8787?sessionId=${sessionId}`);
 * ws.onopen = () => {
 * 	console.log("Connected!");
 * 	ws.send("recent advances in RAG");
 * };
 *  ws.onmessage = (event) => console.log("Got back:", event.data);
 */

export interface Env {
	RESEARCH_WORKFLOW: Workflow;
}

export class SessionDO extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		const upgradeHeader = request.headers.get('Upgrade');

		if (upgradeHeader !== 'websocket') {
			return new Response('Expected a WebSocket upgrade request', { status: 400 });
		}

		const [client, server] = Object.values(new WebSocketPair());
		/* Thought it was cool it could also be:
            const pair = webSocketPair()
            const client = pair[0]
            const server = pair[1]
        */

		// Hands socket to runtime with hibernation capabilities
		this.ctx.acceptWebSocket(server);

		/* 
        server.accept() v. this.ctx.acceptWebSocket(server)
        BOTH say: keep the TCP connection open past the first response
        
        server.accept(): keep the workers JS execution context in memry while 
                         the connection is open
            - the running isolate and event listeners
            - JS heap, closures inside message event linsteners

        this.ctx.acceptWebSocket(server): tear the worker down when idle, build 
                                          it back up when message arrives with
                                          memory based on what's written into 
                                          this.ctx.storage 
        */

		console.log('WebSocket with DO open babyyy');
		return new Response(null, { status: 101, webSocket: client });
	}

	// Called by runtime when message arrives from a specific ws
	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		const query = message.toString();
		console.log('Starting research for query: ', query);

		await this.env.RESEARCH_WORKFLOW.create({
			params: {
				query,
				sessionId: this.ctx.id.toString(),
				// every DO instance has a unique ID
			},
		});

		ws.send(`Started researching: "${query}"`);
	}

	// Called directly by the Workflow via RPC
	async pushUpdate(text: string) {
		for (const ws of this.ctx.getWebSockets()) {
			// and has the text sent out to each // runtime checks what sockets are open and belong to DO instance
			ws.send(text);
		}
		/**
		 * When would there be multiple sockets:
		 *
		 * Flow: Browser opens a WebSocket using  a specific session ID, that connection is handed to the DO
		 *
		 * Multiple connections can land in the same DO's sockect pool
		 * ONLY IF they used the same session ID when connecting
		 *
		 *
		 */
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
		console.log('DO: client disconnected', code, reason);
	}
}
// await ctx.storage.get<type>("name")
// await cts.storage.put("name", value)

//More on WebSocketPair
/*
Weeb sockets establish a pipeline for the browser and
worker to stay connected to even after a full exchange 
is done

Single long-lived, (?)full-duplex TCP connection(?)
Worker holds onto server
Client is handed back to browser 

--
Normal workers: reuest-scoped (response produced, no more pending work, connection teared down)
For sockets...
server.accept() signals it's NOT request-scoped
    instead it keeps the workers execution context pinned in memory until server.close()
this.ctx.acceptWebSocket(server) - is server.accept() but with Hibernation

Hibernation:
Durable Object's JavaScript execution torn down while idle
- the class instance, its in-memory properties, any local variables...
Until you call server.accept()/this.ctx.acceptWebSocket(server), the server end of the pair exists but your code isn't actually wired up to receive or send on it

When is plain in vain:
does this socket ever need to know about, coordinate with, or be reached by anything other than itself? If no, plain Worker. If yes, DO.

Ex) 
*/

/**
 * RPC (remote procedure call)
 * any public method you define on the class can be called straight through the stub
 * - no fetch/Request/Response wrapping needed at all
 * vs
 *
 * talk to SessionDO from outside - stub.fetch(request), like a tiny HTTP server
 * - isn't local
 */

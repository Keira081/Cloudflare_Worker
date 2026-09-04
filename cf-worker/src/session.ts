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

export class SessionDO extends DurableObject {
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

	// Called by runtime when message arrives
	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		console.log('DO received:', message);
		console.log('WebSocket: ', WebSocket);
		ws.send(`echo from Durable Oject: ${message}`);
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
		console.log('DO: client disconnected', code, reason);
	}
}

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

Until you call server.accept()/this.ctx.acceptWebSocket(server), the server end of the pair exists but your code isn't actually wired up to receive or send on it

When is plain in vain:
does this socket ever need to know about, coordinate with, or be reached by anything other than itself? If no, plain Worker. If yes, DO.

Ex) 
*/

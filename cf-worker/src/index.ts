export { SessionDO } from './session';
export { ResearchWorkflow } from './workflow';

export interface Env {
	// Defines the shapes of the env object
	SESSION_DO: DurableObjectNamespace<import('./session').SessionDO>;
	// DurableObjectNamespace<...> - generic type
	// import type { SessionDO } from "./session"; -> <import('./session').SessionDO>
	//                                         shorthand^
	RESEARCH_WORKFLOW: Workflow;
}
// Every binding you declare in wrangler.jsonc needs a matching entry
// here so TypeScript knows it exists and what type it is

export default {
	// Called everytime a rquest hits the Worker
	// request - HTTP Request
	// env- Where bindings show up
	// ctx - execution context
	async fetch(request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/start-workflow') {
			const instance = await env.RESEARCH_WORKFLOW.create({
				params: { query: 'reccent advance in RAG' },
			});
			return new Response(`Started workflow instance: ${instance.id}`);
		}

		const sessionId = url.searchParams.get('sessionId');
		if (!sessionId) {
			return new Response('Missing sessionId query parameter', { status: 400 });
		}

		const id = env.SESSION_DO.idFromName(sessionId);
		const stub = env.SESSION_DO.get(id); // stub - a local proxy for the DO you hold and call methods on
		return stub.fetch(request);
	},
} satisfies ExportedHandler<Env>;

// Worker - Plain JavaScript/TypeScript
// Wangler  - bundles, packages with config, uploads to CF Global network

// Fetch requests - Single transaction ( Browser sends reuest to Worker, Worer sends response, connection closes)
/* WebSocket - Connection between Browser and Worker stays open, eiher can send info to the other without being prompted by the other side
        Reular HTTP request with different handshake
        exsmple Header)
            GET /chat HTTP/1.1
            Upgrade: websocket  <- triggers special kind of response
            Connection: 
        TCP Connection stays open, both sides can send messaes

 TLS handshake and headers break down
 TCP - Transmission Control Protocal
    The transport-layer that sit's behind the internet
    Takes the unreliable packet-based IP networking and turnss it into an ordered stream of btyes
 IP forwards individ packects with no garentee they'll arrive in order or neatly
    - packets could get corrupted, duplicate, or not arrive at all
 TCP is the fix built at the OS level
 TCP connection - A stateful agrrement between two endpoints (IP adrress and port)
                 established before data flows
    3-way handshake:the client sends a SYN packet (roughly "I want to start a connection, here's my starting sequence number"), the server replies SYN-ACK ("okay, acknowledged, here's mine"), and the client replies ACK ("got it, let's go"). After that handshake, both sides have agreed on sequence numbers and are ready to exchange data.
    every byte you send is numbered (sequence numbers), so the receiver can put packets back in the correct order even if they arrive out of order; every packet must be acknowledged, and unacknowledged packets get retransmitted automatically, so data isn't silently lost.

 WebSocket's "upgrade" handshake is just an agreement between browser and server to keep that same underlying TCP connection open indefinitely and stop treating it as one-request-one-response

Docs: https://developers.cloudflare.com/workers/runtime-apis/websockets/
*/

// Runtime - program that executes the code, the engine underneath, workerd

/* Durable Objects - Gives the Worker memory

Problems:
    - Plain Workers: No memory in-between invocations
    - No single location: You can't address a specifc running worker

Durable Objects have...
    - Single-instance Identity through an ID
    - In-memory State Persistance + stoarge that survives restarts
        * Works by pinning the instance to one physical machine or storage
        * so unlike a worker that can be everywhere at once, it's in one place
            - Global distribution v. persistant memory
            - Does that mean low latency doesn't apply with this model? how 
              does it decide what location to attach to? 
Hibernation: lets runtime keep raw TCP connection open while evicting the Durable 
             Object's JavaScript out of memory when it's idle.


______________________________________________________________________________
            | Workers                        | Durable Object
______________________________________________________________________________
Location    | Everywhere at once             | One physical machine
______________________________________________________________________________         
Lifetime    | Torn down after each request   | Persists across requests; 
            |                                | can hibernate and be woken
______________________________________________________________________________
Identity    | None — interchangeable         | Instance attached to ID
______________________________________________________________________________
State       | None between invocations       | In-memory cache + attached 
            |                                | durable storage
______________________________________________________________________________                                            
Use it for  | Stateless request handling,    | Anything that needs to be 
            | routing, fan-out               | "the one place" something lives
            |                                | ex) sessions, counters,
            |                                | coordination, connections
______________________________________________________________________________


*/

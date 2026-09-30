# Learnings from cf-worker-mvp

## 1. Cloudflare Workers basics

- **Worker**: plain JavaScript/TypeScript that runs on Cloudflare's edge.
- **Wrangler**: the CLI that bundles the code, packages it with its config (`wrangler.jsonc`), and uploads it to Cloudflare's global network.
- **Runtime**: the program that actually executes the code, the engine underneath. For Workers this is **`workerd`**.

A Worker ISN'T lightweight VM or container, it's
a V8 **isolate** (same sandboxing technology Chrome uses per browser
tab).
Booting up a VM - loading an OS, then a runtime, then the app. 
Isolates are handed an already-parsed execution context. That's also why a Worker has no memory between invocations by default, because each request gets a fresh isolate.

Durable Objects (§3) exist to deal with memory problem.

### The `fetch` handler

```ts
export default {
  async fetch(request, env: Env, ctx: ExecutionContext): Promise<Response> { ... }
} satisfies ExportedHandler<Env>;
```

It is called every time a request hits the Worker.

| Param     | What it is                                             |
| --------- | ------------------------------------------------------ |
| `request` | The incoming HTTP Request                              |
| `env`     | Where **bindings** show up (DOs, Workflows, AI, vars…) |
| `ctx`     | The execution context (e.g. `ctx.waitUntil()`)         |

**Example from this project (`src/index.ts`)** - routing a request to
either a test Workflow trigger or the right session's Durable Object:

```ts
export default {
	async fetch(request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/start-workflow') {
			const instance = await env.RESEARCH_WORKFLOW.create({
				params: { query: 'recent advances in RAG' },
			});
			return new Response(`Started workflow instance: ${instance.id}`);
		}

		const sessionId = url.searchParams.get('sessionId');
		if (!sessionId) {
			return new Response('Missing sessionId query parameter', { status: 400 });
		}

		const id = env.SESSION_DO.idFromName(sessionId);
		const stub = env.SESSION_DO.get(id);
		return stub.fetch(request);
	},
} satisfies ExportedHandler<Env>;
```

### The `Env` interface

- `Env` defines the shape of the `env` object.
- **Every binding declared in `wrangler.jsonc` needs a matching entry in `Env`**, so TypeScript knows it exists and what type it has.
- `DurableObjectNamespace<...>` is a **generic type**. The type argument says which DO class the namespace holds.
- `DurableObjectNamespace<import('./session').SessionDO>` is shorthand for:
  ```ts
  import type { SessionDO } from './session';
  DurableObjectNamespace<SessionDO>;
  ```

```ts
export interface Env {
	SESSION_DO: DurableObjectNamespace<import('./session').SessionDO>;
	RESEARCH_WORKFLOW: Workflow;
	AI: Ai;
}
```

---

## 2. Networking fundamentals: HTTP, TCP, WebSockets

### Fetch request vs WebSocket

- **Fetch request**: a single transaction. The browser sends a request, the Worker sends a response, and the connection closes.
- **WebSocket**: the connection between browser and Worker **stays open**. Either side can send data to the other at any time without being prompted.
  - It starts as a regular HTTP request with a different handshake:
    ```
    GET /chat HTTP/1.1
    Upgrade: websocket      <- triggers a special kind of response (101 Switching Protocols)
    Connection: Upgrade
    ```
  - The underlying TCP connection stays open and both sides can send messages.
  - It is a single long-lived, "**full-duplex**" connection.
    - full-duplex - both sides can send at the same time, independently.

### TCP (Transmission Control Protocol)

- The transport layer that sits underneath most of the internet.
- **IP** forwards individual packets with **no guarantee** that they arrive in order or intact. Packets can be corrupted, duplicated, or lost.
- **TCP is the fix, built at the OS level.** It turns unreliable packet-based IP networking into an **ordered, reliable stream of bytes**.
- **TCP connection**: a stateful agreement between two endpoints (IP address + port), set up before any data flows.
- **3-way handshake**:
  1. Client → **SYN**: "I want to start a connection; here's my starting sequence number."
  2. Server → **SYN-ACK**: "Okay, acknowledged; here's mine."
  3. Client → **ACK**: "Got it, let's go."
- **Sequence numbers**: every byte sent is numbered, so the receiver can reorder packets that arrive out of order.
- **Acknowledgements**: every packet must be acknowledged. Unacknowledged packets are retransmitted automatically, so data isn't silently lost.
- The WebSocket "upgrade" handshake is just an agreement between browser and server to **keep that same TCP connection open indefinitely** and stop treating it as one-request-one-response.
- (TLS handshake and headers breakdown is still to be written up.)

**Frames:** Once the WebSocket connection is live, neither side sends full 
HTTP requests anymore. The unit of transmission is a **frame**.
A small chunk of bytes with a compact header (length, whether the
payload is text or binary, whether more frames are coming) followed by the
payload itself. For almost everything in this project, one call to
`.send()` is exactly one frame and fires exactly one `message` event on the
other end. The protocol allows a single message to be split across
multiple frames, but the browser's and Cloudflare's WebSocket APIs both
reassemble those automatically before your code ever sees them.

Docs: https://developers.cloudflare.com/workers/runtime-apis/websockets/

---

## 3. Durable Objects: giving the Worker memory

### The problems they solve

- Plain Workers have **no memory between invocations**.
- There's **no single location**: you can't "address" a specific running Worker.

### What Durable Objects provide

- **Single-instance identity** through an ID.
- **In-memory state**, plus **storage that survives restarts**.
- This works by **pinning the instance to one physical location**. A Worker can be everywhere at once but a DO lives in one place.
  - The trade-off is **global distribution vs persistent memory**.
  - _Where does it get placed?_ Cloudflare creates the DO in the data center **closest to where the first request came from**.
  - _Does low latency still apply to DOs?_ it applies only partly. Users near the DO get low latency. Users far away pay a round trip to wherever the DO lives. The Worker still runs at the edge near the user and forwards the call to the DO.

### Workers vs Durable Objects

|            | Workers                                      | Durable Object                                                                                           |
| ---------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Location   | Everywhere at once                           | One physical machine                                                                                     |
| Lifetime   | Torn down after each request\*               | Persists across requests; can hibernate and be woken                                                     |
| Identity   | None; instances are interchangeable          | Instance attached to an ID                                                                               |
| State      | None between invocations                     | In-memory cache + attached durable storage                                                               |
| Use it for | Stateless request handling, routing, fan-out | Anything that needs to be "the one place" something lives: sessions, counters, coordination, connections |

\* Cloudflare _may_ reuse a Worker isolate for later requests, but you can never **rely** on state surviving. For practical purposes, treat it as stateless.

### Addressing a DO: IDs and stubs

```ts
const id = env.SESSION_DO.idFromName(sessionId); // same name -> same DO instance, every time
const stub = env.SESSION_DO.get(id);
return stub.fetch(request);
```

- **Stub**: a local proxy for the DO. You hold it and call methods on it.
- `idFromName(name)` gives a deterministic ID from a string.
- `idFromString(idString)` rebuilds an ID from its string form (`ctx.id.toString()`). The Workflow uses this to find its way back to the session.
- Every DO instance has a unique ID, available inside the class as `this.ctx.id`.

**why `idFromString` isn't just a type cast.** `idFromName`
and `idFromString` are not interchangeable, even though both end up handing
`.get()` a `DurableObjectId`. `idFromName` _hashes_ an arbitrary string into
an ID — you're saying "derive an ID from this name." `idFromString` takes a
string that _already is_ a real ID (e.g. from `this.ctx.id.toString()`) and
hands it back in the correct type, unchanged. Calling `idFromName` on a
string that came from `idFromString`'s counterpart would re-hash an
already-correct ID and land on the wrong, unrelated instance. This is also
why the method lives on the specific namespace (`env.SESSION_DO.idFromString(...)`)
rather than being a free-standing function — a `DurableObjectId` is only
meaningful relative to the class it belongs to.

**A stub doesn't validate anything.** `.get(id)` is cheap
and synchronous; it doesn't check whether that ID corresponds to a
previously-used instance. If a `sessionId` were ever corrupted or
mismatched, `.get()` wouldn't throw an error, it would silently hand back a stub for
a brand-new, empty instance, and the first sign of trouble would be missing
state, not an error.

### Two ways to talk to a DO

- **`stub.fetch(request)`**: talk to the DO from outside like a tiny HTTP server, wrapped in Request/Response. It isn't a local call.
- **RPC (Remote Procedure Call)**: **any public method on the class can be called straight through the stub**, e.g. `sessionStub.pushUpdate(text)`. No fetch/Request/Response wrapping needed.

### Storage

```ts
await this.ctx.storage.get<Type>('name');
await this.ctx.storage.put('name', value);
```

**storage vs. in-memory state.** A plain class property
(`this.someArray = [...]`) survives hibernation but is wiped on a real
restart or crash. `this.ctx.storage` is an actual attached SQLite database
per instance — genuinely durable across restarts, not just hibernation.
Confirmed this directly: sent a few WebSocket messages to bump a
`ctx.storage`-backed counter, killed `wrangler dev` entirely (not just idle
— a full process kill), restarted it, sent another message, and the count
picked up where it left off rather than resetting to zero.

### Config: migrations (`wrangler.jsonc`)

```jsonc
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["SessionDO"] }
]
```

- Cloudflare needs to be told **which storage backend** to give each instance of the DO class.
- `new_sqlite_classes`: **each instance gets its own SQLite database**.
- This is done **once per class**. Later changes (renames, deletions) get new migration tags.

---

## 4. WebSockets inside a Durable Object

### `WebSocketPair`

```ts
const [client, server] = Object.values(new WebSocketPair());
// equivalent to:
// const pair = new WebSocketPair();
// const client = pair[0];
// const server = pair[1];
```

- The Worker/DO **keeps `server`**. `client` is **handed back to the browser** in the 101 response:
  ```ts
  return new Response(null, { status: 101, webSocket: client });
  ```
- **Splicing the client onto the network**: the runtime joins the `client` object to the real network socket.
- Until you call `server.accept()` or `this.ctx.acceptWebSocket(server)`, the server end **exists but your code isn't wired up** to send or receive on it.

**What `WebSocketPair()` is before splicing.**
Before the 101 response is ever returned, `client` and `server` are just two
JS objects wired to each other **inside the Worker's own memory**, nothing
about the browser is involved yet. `.send()` into one immediately fires a
`message` event on the other, purely in-process. The `Response`'s
`webSocket: client` field is the one moment this in-memory pipe gets joined
to the real, already-open TCP connection (the one the browser's handshake
request physically arrived on) — an existing in-memory object being grafted
onto an already-existing network connection, not a new connection being
established.

### `server.accept()` vs `this.ctx.acceptWebSocket(server)`

Both say: **keep the TCP connection open past the first response**. Normal Workers are request-scoped: once the response is produced and there's no pending work, the connection is torn down. Accepting a socket signals that this is _not_ request-scoped.

|                  | `server.accept()`                                                                                                                         | `this.ctx.acceptWebSocket(server)`                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| While idle       | Keeps the Worker's JS execution context **pinned in memory** (running isolate, event listeners, JS heap, closures) until `server.close()` | **Tears the DO's JS down when idle** and rebuilds it when a message arrives |
| State after idle | Everything in memory survives                                                                                                             | In-memory properties are lost; rebuild from `this.ctx.storage`              |
| Handlers         | `server.addEventListener('message', ...)`                                                                                                 | Class methods: `webSocketMessage`, `webSocketClose`, …                      |

`this.ctx.acceptWebSocket(server)` is **`server.accept()` with Hibernation**.

### Hibernation

- It lets the runtime **keep the raw TCP connection open** while **evicting the DO's JavaScript from memory** when idle.
- What gets torn down: the class instance, its in-memory properties, and any local variables.
- Anything that must survive has to live in `this.ctx.storage`.

**Only the JS gets rebuilt, not the connection.** Easy to
assume hibernation tears down and rebuilds "the whole thing," socket
included — it doesn't. The browser never reconnects and there's no new
handshake; the TCP connection is genuinely continuous the entire time. When
a message arrives on a hibernating instance, the runtime reconstructs the
class (reruns the constructor) and calls the relevant handler
(`webSocketMessage`, etc.), handing it the _same, already-open_ socket as a
parameter. The socket's continuity is a guarantee made by the runtime, not
something your code has to re-establish.

### Hibernation handler methods (called by the runtime)

- `webSocketMessage(ws, message)`: a message arrived from a specific socket.
- `webSocketClose(ws, code, reason, wasClean)`: a client disconnected.
- `this.ctx.getWebSockets()`: the runtime checks which sockets are open and belong to this DO instance. It's used to broadcast:
  ```ts
  for (const ws of this.ctx.getWebSockets()) ws.send(text);
  ```

**why `webSocketMessage` never needs `getWebSockets()` but
`pushUpdate` always does.** `webSocketMessage` is _reactive_: the runtime
hands it the exact socket that triggered the call as a parameter, so
replying to "whoever just spoke" needs no lookup. `pushUpdate` (the RPC
method the Workflow calls) is _proactive_ — nothing "just spoke," so there's
no socket handed to it automatically. It has to explicitly ask the runtime
"who is currently connected to me right now" via `getWebSockets()`, since a
freshly-rebuilt instance (post-hibernation) starts with no memory of its
own about who's connected.

**Full working example — the Session Durable Object (`src/session.ts`):**

```ts
import { DurableObject } from 'cloudflare:workers';

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

		// Hands the socket to the runtime with hibernation support, rather than
		// a plain server.accept(), which would keep this instance's JS execution
		// pinned in memory for the entire life of the connection.
		this.ctx.acceptWebSocket(server);

		return new Response(null, { status: 101, webSocket: client });
	}

	// Called by the runtime whenever a message arrives on a socket belonging
	// to this instance — including immediately after waking from hibernation.
	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		const query = message.toString();

		await this.env.RESEARCH_WORKFLOW.create({
			params: {
				query,
				sessionId: this.ctx.id.toString(),
			},
		});

		ws.send(`Started researching: "${query}"`);
	}

	// Called directly by the Workflow via RPC to stream a progress update to
	// every browser tab currently connected to this session.
	async pushUpdate(text: string) {
		for (const ws of this.ctx.getWebSockets()) {
			ws.send(text);
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
		console.log('Session closed:', code, reason);
	}
}
```

### When would one DO have multiple sockets?

The browser opens a WebSocket with a specific session ID, and that connection is handed to the DO for that ID. Multiple connections land in the **same DO's socket pool only if they used the same session ID** when connecting (e.g. two tabs sharing an ID).

**This is session-wide, not per-source or per-anything
else.** `seenTitles`/`getWebSockets()`-type state is scoped to _one shared
Durable Object instance for the whole session_ — not per data source. Two
different browser tabs sharing the same `sessionId` land in the same
socket pool and the same accumulated state; two _different_ sessions never
share anything, since each gets its own DO instance entirely.

### When is a plain Worker enough?

> Does this socket ever need to know about, coordinate with, or be reached by anything other than itself?
> **No** → plain Worker. **Yes** → Durable Object.

### End-to-end flow (testing from the browser console)

```js
const sessionId = crypto.randomUUID();
const ws = new WebSocket(`ws://127.0.0.1:8787?sessionId=${sessionId}`);
ws.onopen = () => {
	console.log('Connected!');
	ws.send('recent advances in RAG');
};
ws.onmessage = (event) => console.log('Got back:', event.data);
```

1. `new WebSocket(...)`: the console acts as the browser and starts the handshake (GET with `Upgrade: websocket`).
2. The request hits `index.ts`, which routes it to the stub, and `stub.fetch(request)` calls the DO's `fetch`.
3. The pair is created and `this.ctx.acceptWebSocket(server)` is called.
4. The 101 response is sent back and the runtime splices `client` onto the network.
5. `ws.onopen` fires.
6. `ws.send(...)` from the browser is caught by `webSocketMessage`.
7. `ws.onmessage` catches whatever the server sends back.

---

## 5. Workflows: durable multi-step execution

- A Workflow class extends `WorkflowEntrypoint<Env, Params>` and implements `run(event, step)`.
- `event.payload` holds the params passed to `env.RESEARCH_WORKFLOW.create({ params: {...} })`.
- Each `step.do('name', async () => {...})` is a **durable, retryable unit**. Its return value is persisted, so if the Workflow restarts, completed steps aren't re-run.
- Design principle from the pipeline plan:
  - Work that **doesn't change batch to batch** (e.g. generating the ontology) runs **once, before the loop**.
  - Loop steps get **unique names per iteration** (`fetch-batch-${batchNumber}`) so each is tracked separately.
  - Deterministic logic (threshold filtering, saturation checks) is plain code inside steps. LLM calls are kept schema-constrained.
- A **safety ceiling** (`MAX_BATCHES`) prevents an infinite loop while the real stop condition (saturation) isn't built yet.
- The Workflow talks back to the user through **RPC on the session DO**: `idFromString(sessionId)` → `get(id)` → `sessionStub.pushUpdate(...)`.

### Config

```jsonc
"workflows": [{
  "name": "RESEARCH_WORFLOW",          // workflow name on Cloudflare
  "binding": "RESEARCH_WORKFLOW",      // name that shows up on `env` in code
  "class_name": "ResearchWorkflow"
}]
```

Docs: https://developers.cloudflare.com/workflows/ · Getting started: https://developers.cloudflare.com/workflows/get-started/

---

## 6. Workers AI: schema-constrained generation

- Bound with `"ai": { "binding": "AI" }` and typed as `AI: Ai` in `Env`.
- Called with `ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages, response_format })`.
- `response_format: { type: 'json_schema', json_schema: {...} }` forces the output to match a JSON schema.

### Prompt-engineering lessons from the test runs

- **Name the downstream use.** Saying "these terms become search queries, so a missing synonym is a paper never found" makes the model more thorough.
- **One cluster per explicitly named subject.** Clusters are ANDed together, so extra clusters make the search too narrow. Narrower techniques go inside the parent's `methods`.
- **Define terms precisely.** A synonym is something you can substitute _and mean exactly the same thing_. It is not a related, parent, or overlapping field ("automation" ≠ "robotics").
- **Give a worked example** ("AI applied to cybersecurity" → 2 clusters, not 5).
- **Ban filler**: no padding, no abbreviation duplicates, and no generic words like "research", "study", "analysis".
- **Shape the schema to the problem.** A flat `{concepts, methods, synonyms}` mixed terms across topics. Moving to `topics: [{concept, synonyms, methods}]` kept each term attached to its concept.

Example input/output pair from real testing:

```
query: "Is there meaningful research combining large language models with formal verification?"

response: {
  topics: [
    {
      concept: "large language models",
      synonyms: ["LLMs"],
      methods: ["model checking", "proof assistants"]
    },
    {
      concept: "formal verification",
      synonyms: ["software verification"],
      methods: ["model checking", "proof assistants"]
    }
  ]
}
```

---

## 7. Statistical methodology

This section describes both the **original approach** (Cochran's formula,
§7.1–7.2) and the **current approach** it was replaced with
(saturation-based evidence gathering, §7.3 onward). Both are documented
here on purpose — the reasoning behind _why_ the first one was wrong for
this problem is as much a real learning as the fix itself.

### 7.1 Why not take the first X results?

- APIs return results in a set order (likely most-recent-first, or
  relevance-sorted), so the first X papers are **not a random sample**.
- That would **overrepresent very new papers** and underrepresent
  foundational or influential work, which gives an inaccurate picture of
  real trends.
- → A **random sample** is needed (OpenAlex supports this via the `sample`
  param — see §8).

### 7.2 Cochran's formula (superseded — see §7.3)

**n₀ = (Z² × p × (1 − p)) / e²**

| Symbol | Meaning                                                                         |
| ------ | ------------------------------------------------------------------------------- |
| Z      | z-score for the confidence level (1.96 for 95%)                                 |
| p      | estimated proportion of the population with the trait (0.5 = most conservative) |
| e      | acceptable margin of error, as a decimal                                        |

- It answers questions like "what fraction of papers mention topic X?"
- **Choosing the margin of error** depends on:
  - what's at stake if you're wrong
  - the cost of collecting more data. A tighter margin gets expensive fast because e is squared in the denominator.
    - the growth is _quadratic_, not exponential. Halving e multiplies n by 4 (97 at e=0.10, 385 at e=0.05).

**Finite population correction**, for when the population size N for a
stratum is known:

**n = n₀ / (1 + (n₀ − 1) / N)**

**Why this formula turned out to be the wrong tool, found by actually
questioning the numbers it produced:** run the formula against a real
per-source population — say `N = 40,003` papers — and the corrected sample
size comes out to the _same_ ~97, indistinguishable from running it against
a population of over a million. That's not a bug in the formula. It's
because the finite population correction only ever pulls the required
sample size _down_, and only meaningfully when `N` is small relative to the
baseline `n₀` — against any population that's "large" relative to a
few-hundred-paper sample, the correction is mathematically negligible.

The deeper issue underneath that: Cochran's formula answers "how many
random draws do I need from a population I've already correctly defined,"
not "have I found enough of the _relevant_ evidence for this topic." It's
the same math behind why a national political poll only needs ~1,000
respondents regardless of whether the country has 5 million or 250 million
voters — precision depends on sample size, not on what fraction of the
population you sampled. That's a real, useful fact for estimating one
proportion from an already-defined population. It has nothing to say about
whether the _population itself_ — "papers relevant to this topic" — was
adequately explored in the first place, which is the actual question this
project needs answered.

### 7.3 Saturation-based evidence gathering (current approach)

Replaces a single pre-computed sample size with **sequential sampling**:
keep gathering evidence in batches, and decide after each batch — based on
what was actually found — whether to keep going or stop. This is
established statistical methodology (the same family as Wald's sequential
probability ratio test, used in contexts like clinical trials), not an
improvised replacement.

Two signals, tracked per batch, both have to agree before stopping:

**Retrieval saturation rate** — the fraction of a batch that's genuinely
new, previously-unseen, relevant evidence:

```
saturation_rate = new_unique_relevant_papers_in_batch / total_candidates_in_batch
```

A high rate means there's still a lot of unexplored, relevant material out
there; a rate that's dropped toward zero means further searching is mostly
re-finding what's already known.

**Estimate stability** — how much the tracked statistic (e.g. "% of papers
mentioning topic X") has moved between the current batch and the previous
one:

```
Δestimate = |current_batch_estimate − previous_batch_estimate|
```

**Why both, not just one:** they catch different failure modes.
High saturation + stable estimate can still mean too little data overall.
Low saturation + still-moving estimate is the more concerning case — it
means a small amount of new evidence is having an outsized effect on the
result, which can happen if the sample was too thin for that topic to begin
with. Low saturation _and_ a stable estimate is the actual, trustworthy
signal to stop.

**Why deduplication doesn't make saturation tracking redundant:** these
answer different questions entirely. Dedup guarantees the same paper is
never counted twice — it only ever looks backward ("have I seen this exact
paper before"). Saturation rate is forward-looking: even with zero
duplicates, a batch of entirely unique, on-topic papers can still represent
almost no _new information_, if they're all reinforcing ground already
well-covered by earlier batches.

Dropping Cochran did _not_ mean discarding papers that cover
similar ground to ones already found. Two genuinely distinct papers that
happen to reach similar conclusions are both real, independent evidence of
how much attention a topic is getting — they should both be counted, not
filtered out. Saturation rate isn't deciding _what counts as evidence_; it's
deciding _when to stop looking for more of it_. That distinction — dedup
removes literal repeats, the relevance filter removes off-topic candidates,
saturation only ever governs when the loop stops — is what keeps "how
popular is this topic" measured honestly by real volume.

### 7.4 Wilson score interval

Used instead of the naive normal-approximation confidence interval for a
proportion:

```
p̂ ± Z × √(p̂(1−p̂)/n)          ← naive, breaks down at small n or extreme p̂
```

The naive formula can produce a confidence interval that dips below 0% or
above 100% — a nonsensical claim — specifically at small sample sizes or
when the observed proportion is near an edge (e.g. 3 out of 20 papers
mentioning something rare). The Wilson interval works from the actual
binomial distribution instead of approximating around the sample
proportion, and never produces an impossible bound:

```
(p̂ + Z²/2n ± Z√(p̂(1−p̂)/n + Z²/4n²)) / (1 + Z²/n)
```

Concrete comparison, 3 out of 20 papers (p̂ = 15%), 95% confidence:
naive gives roughly **−0.6% to 30.6%**; Wilson gives roughly **5.3% to
34.6%** — wider, but always valid, and honestly reflecting how little
precision 20 samples actually buys.

Wilson interval **width**, tracked batch over batch, doubles as a second
practical view into estimate stability (§7.3) — a narrowing interval as
evidence accumulates is direct, principled evidence of convergence on a
trustworthy number, not just an assertion of one.

### 7.5 Benjamini–Hochberg (BH) correction

Applied whenever multiple topics are tested for statistical significance at
once — which, in a trend report covering several sub-topics, is always.
Testing many hypotheses simultaneously without correcting for how many
tests were run will surface some "significant" results by pure chance, even
if nothing real is happening — a well-documented statistical trap
(multiple-comparisons / false discovery). BH correction adjusts the
significance threshold based on how many tests are being run, so the agent
doesn't report a handful of "trends" that are actually noise.

### 7.6 Shannon diversity index

A single number describing how concentrated vs. spread out research
attention is across sub-topics within the retrieved evidence — the direct,
quantifiable answer to "where are the gaps" in a topic's literature, rather
than a qualitative impression. Higher values indicate attention spread
fairly evenly across sub-topics; lower values indicate a few sub-topics
dominating.

---

## 8. External APIs: OpenAlex (and lessons from arXiv)

- **Polite pool**: adding `mailto=<email>` to requests joins OpenAlex's polite pool (better rate limits).
- Useful query params: `search`, `filter=has_abstract:true`, `sample=N` (random sample), `per-page`, and `select=` (return only the fields you need).
- **Abstracts come as an inverted index** (`{ word: [positions] }`). To rebuild one, find the highest position, allocate an array of that length, and place each word at its positions.
- Handle `429` (rate limit) separately from other non-`ok` responses.
- **Deduplicate by normalized title** (`trim().toLowerCase()`), both across batches (`seenTitles`) and within a batch (`reviewedTitles`).
- **Track why things were discarded** (no abstract, duplicate) and whether the population is exhausted. These numbers feed the coverage disclosure later.

**OpenAlex's default ordering is relevance-sorted, not
random.** Without `sample`, `search=` results come back ranked by a
`relevance_score` — paginating through them, however deep, just walks down
that same ranking; it never becomes a random draw. Relevance-sorting
introduces its own bias distinct from "recency-first": it systematically
favors papers whose title/abstract most closely echoes the literal query
wording, potentially under-representing papers that are genuinely on-topic
but phrased differently. `sample=N` (optionally with a fixed `seed` for a
reproducible, paginate-able draw) is what actually fixes this.

**A genuinely random draw can still need irrelevant
candidates filtered out.** Switching from relevance-sorted pagination to
true random sampling removes an _implicit_ side-benefit relevance-sorting
happened to provide: weak matches used to be effectively hidden by ranking
low. A random sample can surface a paper that technically matches the
search terms but isn't really _about_ the topic. This is by design, not a
regression — it's exactly the job the Relevance Filter (§7.3, downstream of
retrieval) exists to do deliberately and inspectably, rather than relying on
an accidental side effect of a biased sort order.

**A "successful" API response can still describe a
failure.** Hit this directly with arXiv (a different source used elsewhere
in the larger project): a malformed query returned HTTP 200 with
well-formed XML, `<opensearch:totalResults>1</opensearch:totalResults>`,
and a single `<entry>` whose `<title>` was literally `Error` — arXiv's own
documented way of wrapping an internal failure as if it were one normal
search result, rather than a real HTTP error code. A regex pulling
`totalResults` out of that response would happily return `1`, looking like
a legitimate (if small) result. Worth an explicit content check
(`xml.includes('<title>Error</title>')`) rather than trusting a 200 status
and a parseable number alone. Separately, a genuine `429 Too Many Requests`
from the same API returned a plain-text body (`"Rate exceeded."`) that
initially got misdiagnosed as a query-syntax bug rather than a rate limit,
before checking `response.status` directly settled it.

---

## 9. Wrangler config quick reference

| Key                            | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| `main`                         | Entry file (`src/index.ts`)                   |
| `compatibility_date`           | Pins runtime behavior to a date               |
| `observability.enabled`        | Logs/traces in the dashboard                  |
| `durable_objects.bindings`     | `name` (on `env`) → `class_name`              |
| `migrations`                   | Storage backend per DO class (SQLite)         |
| `workflows`                    | `binding` (on `env`) → `class_name`           |
| `ai.binding`                   | Workers AI on `env.AI`                        |
| `placement: { mode: "smart" }` | Smart Placement (optional)                    |
| `vars` / secrets               | Env variables; use secrets for sensitive data |
| `assets`                       | Static assets binding                         |
| `services`                     | Service bindings between Workers              |

Bindings docs: https://developers.cloudflare.com/workers/runtime-apis/bindings/

---

## 10. Things considered and deliberately not built

Worth a real answer for "why not X," rather than leaving a silent gap:

- **Snowball sampling** (following citation links outward from seed
  papers) — sounds like an easy way to get more data fast. It breaks the
  random-sampling assumption every statistic in §7 depends on, since
  heavily-cited papers get pulled in repeatedly from multiple directions
  while newer or niche work never gets a chance to surface.
- **Capture-recapture population estimation across sources** — real
  statistics, but requires the sources to be genuinely _independent_
  captures of the population. OpenAlex and Semantic Scholar both ingest
  from overlapping upstream feeds (Crossref, arXiv), so a paper appearing
  in both isn't really two independent discoveries of it — the estimator
  would likely be structurally wrong, not just approximate.
- **Fully automated extraction of structured facts from papers** (pulling
  out something like "4 models × 5 datasets" as discrete data points) — a
  genuinely hard, open NLP problem. Attempting it from an abstract alone
  would mean an LLM inventing specificity the abstract doesn't actually
  contain, reintroducing exactly the hallucination risk §6's
  schema-constrained approach exists to prevent.

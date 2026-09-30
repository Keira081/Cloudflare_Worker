// Worker entry point- routes each request to a session's Durable Object.
// Concepts (Workers, WebSockets, TCP, Durable Objects)
export { SessionDO } from './session';
export { ResearchWorkflow } from './workflow';

// Shape of `env`. Every binding in wrangler.jsonc needs a matching entry here.
export interface Env {
	// `import('./session').SessionDO` is an inline type import, same as `import type { SessionDO } from './session'`
	SESSION_DO: DurableObjectNamespace<import('./session').SessionDO>;
	RESEARCH_WORKFLOW: Workflow;
}

export default {
	// Runs on every request. `env` holds the bindings. `ctx` is the execution context.
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

		// Same sessionId -> same DO instance. The stub is a local proxy for calling it.
		const id = env.SESSION_DO.idFromName(sessionId);
		const stub = env.SESSION_DO.get(id);
		return stub.fetch(request);
	},
} satisfies ExportedHandler<Env>;

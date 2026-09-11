import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';

type Params = {
	query: string;
	sessionId: string;
};

export interface Env {
	SESSION_DO: DurableObjectNamespace<import('./session').SessionDO>;
	AI: Ai;
}

export class ResearchWorkflow extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		const { query, sessionId } = event.payload;

		const id = this.env.SESSION_DO.idFromString(sessionId);
		const sessionStub = this.env.SESSION_DO.get(id);

		const plan = await step.do('plan', async () => {
			await sessionStub.pushUpdate(`Planning research for: "${query}"`);

			const response = await this.env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
				messages: [
					{
						role: 'system',
						content:
							"You are a research planning assistant. Given a topic, respond with a JSON object containing 'sources' (an array of relevant academic source names from: arxiv, openalex, semanticscholar) and 'sampleSize' (a number between 10 and 50).",
					},
					{ role: 'user', content: query },
				],
			});
			return response;
		});

		const results = await step.do('fetch-sources', async () => {
			await sessionStub.pushUpdate(`Fetching from plan...`);
			return { papersFound: 42 };
		});

		const summary = await step.do('summarize', async () => {
			await sessionStub.pushUpdate(`Found ${plan.response}`);
			return `Found ${plan.response}`;
		});

		return summary;
	}
}

// Workflow Docs:   https://developers.cloudflare.com/workflows/
// Getting started: https://developers.cloudflare.com/workflows/get-started/

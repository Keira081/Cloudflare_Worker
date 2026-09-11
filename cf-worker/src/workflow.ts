import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { buildPlan } from './methodologyGuard';
import { generateSourceQueries } from './queryGenerator';

type Params = {
	query: string;
	sessionId: string;
};

export interface Env {
	SESSION_DO: DurableObjectNamespace<import('./session').SessionDO>;
	AI: Ai;
}
/**
 * plan — sources (fixed) + provisional/default sample size (Cochran baseline, no N yet)
 * generate-queries — LLM turns the topic into a real per-source query string (already built)
 * count-population — for each source, fire a lightweight count-only call using that real query string, get back N per source
 * refine-sample-sizes — apply the finite population correction per source, using each source's own N, producing a per-source sample size rather than one flat number for everyone
 * 			function applyFinitePopulationCorrection(n0: number, N: number): number {
 *				return Math.ceil(n0 / (1 + (n0 - 1) / N));
 *			}
 * fetch-sources — now pulls the actual number of papers determined by step 4, using the real queries from step 2
 */
export class ResearchWorkflow extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		const { query, sessionId } = event.payload;

		const id = this.env.SESSION_DO.idFromString(sessionId);
		const sessionStub = this.env.SESSION_DO.get(id);

		const plan = await step.do('plan', async () => {
			const result = buildPlan();
			await sessionStub.pushUpdate(`Plan: sampling ${result.sampleSize} papers each from ${result.sources.join(', ')}`);
			return result;
		});

		const sourceQueries = await step.do('generate-queries', async () => {
			const queries = await generateSourceQueries(this.env.AI, query, plan.sources);
			console.log('Generated per-source queries:', queries);
			await sessionStub.pushUpdate(`Queries prepared for ${plan.sources.length} sources.`);
			return queries;
		});

		const results = await step.do('fetch-sources', async () => {
			await sessionStub.pushUpdate(`Fetching from ${plan.sources.join(', ')}...`);
			// sourceQueries[source] will be the real per-source query string, once
			// the real adapters exist to actually use it
			return { papersFound: 42 };
		});

		const summary = await step.do('summarize', async () => {
			const text = `Found ${results.papersFound} papers using ${plan.sources.join(', ')} (target sample size: ${plan.sampleSize})`;
			await sessionStub.pushUpdate(text);
			return text;
		});

		return summary;
	}
}

// Workflow Docs:   https://developers.cloudflare.com/workflows/
// Getting started: https://developers.cloudflare.com/workflows/get-started/

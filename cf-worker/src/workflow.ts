import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { buildPlan } from './methodologyGuard';
import { generateSourceQueries } from './queryGenerator';
import { getArxivPopulationCount } from './sources/arxiv';

type Params = {
	query: string;
	sessionId: string;
};

export interface Env {
	SESSION_DO: DurableObjectNamespace<import('./session').SessionDO>;
	AI: Ai;
}
/**
 * Flow:
 * plan - default sample size (Cochran baseline)
 * generate queries - LLM turns the topic into a real per-source query string
 * count-population - for each source, send a count-only call using that query string, get back N per source
 * refine-sample-sizes - apply the small population correction per source, using each source's own N
 * 			function applyPopulationCorrection(n0: number, N: number): number {
 *				return Math.ceil(n0 / (1 + (n0 - 1) / N));
 *			}
 * fetch-sources — pull the actual number of papers determined by step 4, using the queries from step 2
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
			// Example object returned:
			/**
			 *
			 */
		});

		const sourceQueries = await step.do('generate-queries', async () => {
			const queries = await generateSourceQueries(this.env.AI, query, plan.sources);
			console.log('Generated per-source queries:', queries);
			await sessionStub.pushUpdate(`Queries prepared for ${plan.sources.length} sources.`);
			return queries;
			// Example object returned:
			/**
			 *
			 */
		});

		const populationCounts = await step.do('count-population', async () => {
			const counts: Record<string, number> = {}; // Tell me about this Record object

			counts.arxiv = await getArxivPopulationCount(sourceQueries.arxiv);
			counts.openalex = 100000;
			counts.semanticscholar = 100000;

			console.log('Population counts:', counts);
			await sessionStub.pushUpdate(`Population counts: ${JSON.stringify(counts)}`);
			return counts;
			// Example object returned:
			/**
			 *
			 */
		});

		function applyFinitePopulationCorrection(n0: number, N: number): number {
			return Math.ceil(n0 / (1 + (n0 - 1) / N));
		}

		const refinedSampleSizes = await step.do('refine-sample-sizes', async () => {
			const sizes: Record<string, number> = {};

			console.log('In for (const source of plan.sources), plan.sources is: ', plan.sources);

			for (const source of plan.sources) {
				sizes[source] = applyFinitePopulationCorrection(plan.sampleSize, populationCounts[source]);
			}

			console.log('Refined sample sizes:', sizes);
			await sessionStub.pushUpdate(`Refined sample sizes: ${JSON.stringify(sizes)}`);
			return sizes;
			// Example object returned:
			/**
			 *
			 */
		});

		const results = await step.do('fetch-sources', async () => {
			await sessionStub.pushUpdate(`Fetching from ${plan.sources.join(', ')}...`);
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

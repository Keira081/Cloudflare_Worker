import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { buildPlan } from './methodologyGuard';
import { generateSourceQueries } from './queryGenerator';
import { getArxivPopulationCount } from './sources/arxiv';
import { getOpenAlexPopulationCount } from './sources/openalex';

type Params = {
	query: string;
	sessionId: string;
};

export interface Env {
	SESSION_DO: DurableObjectNamespace<import('./session').SessionDO>;
	AI: Ai;
	OPENALEX_MAILTO?: string; // from .dev.vars locally, or `wrangler secret put OPENALEX_MAILTO`
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
			 * {
			 * 	sources: [ 'arxiv', 'openalex', 'semanticscholar' ],
			 * 	sampleSize: 97
			 * }
			 */
		});

		const sourceQueries = await step.do('generate-queries', async () => {
			const queries = await generateSourceQueries(this.env.AI, query, plan.sources);
			console.log('Generated per-source queries:', queries);
			await sessionStub.pushUpdate(`Queries prepared for ${plan.sources.length} sources.`);
			return queries;
			// Example object returned:
			/**
			 * {
			 * 	arxiv: 'RAG advances',
			 * 	openalex: 'RAG recent developments',
			 * 	semanticscholar: 'recent RAG progress'
			 * }
			 */
		});

		const populationCounts = await step.do('count-population', async () => {
			const counts: Record<string, number> = {}; // Tell me about this Record object

			// counts.arxiv = await getArxivPopulationCount(sourceQueries.arxiv);
			counts.arxiv = 100000;
			counts.openalex = await getOpenAlexPopulationCount(sourceQueries.openalex, this.env.OPENALEX_MAILTO);
			counts.semanticscholar = 100000;

			console.log('Population counts:', counts);
			await sessionStub.pushUpdate(`Population counts: ${JSON.stringify(counts)}`);
			return counts;
			// Example object returned:
			/**
			 * { arxiv: 100000, openalex: 100000, semanticscholar: 100000 }
			 */
		});

		function applyFinitePopulationCorrection(n0: number, N: number): number {
			console.log(`${n0} / (1 + (${n0} - 1) / ${N} = `, Math.ceil(n0 / ((1 + (n0 - 1)) / N)));
			return Math.ceil(n0 / (1 + (n0 - 1) / N));
		}

		const refinedSampleSizes = await step.do('refine-sample-sizes', async () => {
			const sizes: Record<string, number> = {};

			for (const source of plan.sources) {
				console.log(`populationCounts[source] for ${source}: `, populationCounts[source]);
				sizes[source] = applyFinitePopulationCorrection(plan.sampleSize, populationCounts[source]);
			}

			console.log('Refined sample sizes:', sizes);
			await sessionStub.pushUpdate(`Refined sample sizes: ${JSON.stringify(sizes)}`);
			return sizes;
			// Example object returned:
			/**
			 * { arxiv: 97, openalex: 97, semanticscholar: 97 }
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

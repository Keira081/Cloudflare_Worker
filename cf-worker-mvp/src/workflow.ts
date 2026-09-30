// ResearchWorkflow: the research pipeline for one query. Each step.do() is durable and retryable,
// and progress is pushed back to the browser via RPC on the session's DO.
// Helpful docs: https://developers.cloudflare.com/workflows/

// ** The sections i'm referencing are in my design doc (not attached to this repo)
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { uniqueOpenalexBatch } from './sources/openalex';
import type { Paper } from './sources/openalex';
import { generateOntologyObject } from './generateOntologyObject';

type Params = {
	query: string;
	sessionId: string;
};

export interface Env {
	SESSION_DO: DurableObjectNamespace<import('./session').SessionDO>;
	AI: Ai;
	OPENALEX_MAILTO?: string; // from .dev.vars locally, or `wrangler secret put OPENALEX_MAILTO`
}

export class ResearchWorkflow extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		const { query, sessionId } = event.payload;
		const id = this.env.SESSION_DO.idFromString(sessionId);
		const sessionStub = this.env.SESSION_DO.get(id);

		// is accumulated across all batches, holds titles already seen (for dedup)
		const seenTitles = new Set<string>();
		// the evidence set (also accumulated across all batches)
		const allPapers: Paper[] = [];

		// §4.4: runs once, before the loop, because the ontology doesn't change between batches.
		const ontology = await step.do('generate-ontology', async () => {
			return await generateOntologyObject(this.env.AI, query);
		});

		await sessionStub.pushUpdate('ontology');
		await sessionStub.pushUpdate(JSON.stringify(ontology, null, 2));

		// ---- Batch loop ----
		// const queries = expandOntologyToQueries(ontology); // plain code, deterministic
		// const exhaustedQueries = new Set<string>();
		// let queryIndex = 0;

		// let saturated = false;
		// let batchNumber = 0;
		// const MAX_BATCHES = 5; // ceiling until real saturation logic (§4.6/§4.7) exists

		/**
			let queryIndex = 0;

			while (exhaustedQueries.has(queries[queryIndex])) {
			queryIndex++;
			if (queryIndex >= queries.length) {
				queryIndex = 0; // wraps around to cycle through queries
			}
			}
			const currentQuery = queries[queryIndex];
		 */

		// while (!saturated && batchNumber < MAX_BATCHES) {
		// 	batchNumber++;

		// 	// §4.3: OpenAlex paginated fetch
		// 	const fetchedBatch = await step.do('fetch-batch', async () => {
		// 		const fetched = await uniqueOpenalexBatch(query, seenTitles, this.env.OPENALEX_MAILTO);
		// 		await sessionStub.pushUpdate(
		// 			[
		// 				`\n\nBatch ${batchNumber} - query: "${query}"`,
		// 				`Total population: ${fetched.totalMatching}`,
		// 				`Total discarded population for no abstract: ${fetched.discardedNoAbstract}`,
		// 				`Total discarded population for duplications: ${fetched.discardedDuplicates}`,
		// 			].join('\n\n'),
		// 		);

		// 		return fetched;
		// 	});

		// 	for (const p of fetchedBatch.papers) {
		// 		seenTitles.add(p.title.trim().toLowerCase());
		// 	}
		// 	allPapers.push(...fetchedBatch.papers);

		// step.do(`embed-and-fuse-${batchNumber}`, ...)   // §4.5: rank candidates vs ontology terms (embedding similarity + keyword score)
		// step.do(`filter-relevance-${batchNumber}`, ...) // §4.6: drop anything below the fused-score cutoff
		// step.do(`compute-stats-${batchNumber}`, ...)    // §4.7: Wilson interval, coverage, saturation rate (new relevant / examined)

		// §4.6: deterministic stop/continue
		// const saturationCheck = await step.do(`check-saturation-${batchNumber}`, async () => {
		//   ...compare saturation rate + Wilson interval width against thresholds...
		//   return { saturated: boolean, reason: string };
		// });
		// saturated = saturationCheck.saturated;

		// Temporary stop condition until §4.6/§4.7 exist: stop when the query has no results left.
		// 	if (fetchedBatch.exhaustedPop) {
		// 		saturated = true;
		// 	}
		// }

		// const results = await step.do('results', async () => {
		// 	await sessionStub.pushUpdate(`Finished after ${batchNumber} batch(es). Total unique papers: ${allPapers.length}`);
		// 	return { papersFound: allPapers.length, batchesRun: batchNumber };
		// });

		// step.do('synthesize', ...) // §4.8: schema-constrained LLM summary with causal-inference guardrail; runs once after the loop

		// const summary = await step.do('summarize', async () => {
		// 	await sessionStub.pushUpdate(`summary of results ...`);
		// 	return '';
		// });

		// return summary;
	}
}

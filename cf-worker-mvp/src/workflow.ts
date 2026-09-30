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
}

export class ResearchWorkflow extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		const { query, sessionId } = event.payload;
		const id = this.env.SESSION_DO.idFromString(sessionId);
		const sessionStub = this.env.SESSION_DO.get(id);
		// the running, accumulated set across every batch, keeping track of papers already touched
		const seenTitles = new Set<string>();
		// the running, accumulated evidence set across every batch
		const allPapers: Paper[] = [];

		const ontology = step.do('generate-ontology', async () => {
			return await generateOntologyObject(this.env.AI, query);
		}); // §4.4 — Workers AI, schema-constrained Runs ONCE, before the loop —
		//      the ontology doesn't change batch to batch, only how much has been
		//      fetched from it does.

		sessionStub.pushUpdate('ontology');
		sessionStub.pushUpdate(await JSON.stringify(ontology));
		// const queries = expandOntologyToQueries(ontology); // plain code, deterministic
		// const exhaustedQueries = new Set<string>();
		// let queryIndex = 0;

		// let saturated = false;
		// let batchNumber = 0;
		// ScheduledEvent;
		// const MAX_BATCHES = 5; // placeholder ceiling until real saturation logic exists —
		//                        prevents an infinite loop while §4.6/§4.7 aren't built yet.

		/**
			let queryIndex = 0;

			while (exhaustedQueries.has(queries[queryIndex])) {
			queryIndex++;
			if (queryIndex >= queries.length) {
				queryIndex = 0; // wrap back to the start — the actual cycling behavior
			}
			}
			const currentQuery = queries[queryIndex];
		 */

		// while (!saturated && batchNumber < MAX_BATCHES) {
		// 	batchNumber++;

		// 	const fetchedBatch = await step.do('fetch-batch', async () => {
		// 		const fetched = await uniqueOpenalexBatch(query, seenTitles);
		// 		await sessionStub.pushUpdate(
		// 			[
		// 				`\n\nBatch ${batchNumber} - query: "${query}"`,
		// 				`Total population: ${fetched.totalMatching}`,
		// 				`Total discarded population for no abstract: ${fetched.discardedNoAbstract}`,
		// 				`Total discarded population for duplications: ${fetched.discardedDuplicates}`,
		// 			].join('\n\n'),
		// 		);

		// 		return fetched;
		// 	}); // §4.3 — OpenAlex paginated fetch

		// 	for (const p of fetchedBatch.papers) {
		// 		seenTitles.add(p.title.trim().toLowerCase());
		// 	}
		// 	allPapers.push(...fetchedBatch.papers);

		// step.do(`embed-and-fuse-${batchNumber}`, ...)   // §4.5 — new hybrid retrieval module.
		//   Ranks this batch's candidates against the ontology's terms via
		//   embedding cosine similarity, fused with keyword confidence.

		// step.do(`filter-relevance-${batchNumber}`, ...) // §4.6 — deterministic threshold.
		//   Drops anything below the fused-score cutoff; only survivors
		//   get added to whatever the Stats Engine treats as real evidence.

		// step.do(`compute-stats-${batchNumber}`, ...)    // §4.7 — Stats Engine.
		//   Runs on `allPapers` as accumulated so far — Wilson interval,
		//   coverage disclosure, and this batch's saturation rate
		//   (new_unique_relevant_this_batch / candidates_examined_this_batch).

		// const saturationCheck = await step.do(`check-saturation-${batchNumber}`, async () => {
		//   ...compare saturation rate + Wilson interval width against thresholds...
		//   return { saturated: boolean, reason: string };
		// }); // §4.6 — deterministic stop/continue
		// saturated = saturationCheck.saturated;

		// Temporary stand-in for the real saturation check above, so the
		// loop is testable before §4.6/§4.7 exist:
		// 	if (fetchedBatch.exhaustedPop) {
		// 		saturated = true; // nothing left for this query — real stopping
		// 		//                   signal we already built, worth honoring now
		// 	}
		// }

		// const results = await step.do('results', async () => {
		// 	await sessionStub.pushUpdate(`Finished after ${batchNumber} batch(es). Total unique papers: ${allPapers.length}`);
		// 	return { papersFound: allPapers.length, batchesRun: batchNumber };
		// });

		// step.do('synthesize', ...) // §4.8 — Workers AI, schema-constrained,
		//   causal-inference guardrail. Runs once, after the loop, on the
		//   final accumulated allPapers + whatever the Stats Engine computed.

		// const summary = await step.do('summarize', async () => {
		// 	await sessionStub.pushUpdate(`summary of results ...`);
		// 	return '';
		// });

		// return summary;
	}
}

// Workflow Docs:   https://developers.cloudflare.com/workflows/
// Getting started: https://developers.cloudflare.com/workflows/get-started/

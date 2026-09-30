// Expands a research query into topic clusters (concept + synonyms + methods) using Workers AI.
// response_format forces the output to match the JSON schema below.
export type TopicCluster = {
	concept: string;
	synonyms: string[];
	methods: string[];
};

export type OntologyObject = {
	topics: TopicCluster[];
};

export async function generateOntologyObject(ai: Ai, query: string): Promise<OntologyObject> {
	const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
		messages: [
			{
				role: 'system',
				content:
					'This system is for academic and scientific literature search. ' +
					'You expand a research query into one or more topic clusters, each with a canonical concept, its synonyms, and related methods. ' +
					'These terms are combined into search queries against academic databases — a synonym or method you leave out is a paper the search will never find. ' +
					"Create exactly one topic cluster per distinct subject explicitly named in the query — never split a single named subject into multiple clusters, and never create a cluster for something the query didn't name as its own topic. " +
					'A narrower technique, application, or subtopic belongs inside its parent topic\'s "methods" list, not as its own cluster — ask "is this a topic the query named, or a technique within a topic it named" before creating a new cluster. ' +
					'For example, a query about "AI applied to cybersecurity" names two topics (AI, cybersecurity) — not five, with "threat detection" or "incident response" each getting their own cluster; those belong inside cybersecurity\'s methods. ' +
					'These clusters are combined with AND when searching, so inventing extra clusters makes the search overly narrow and can return almost nothing. ' +
					'For "synonyms": include every genuinely distinct alternate name for the concept itself — alternate names or closely related phrasings for the concept, not for anything else in the cluster. ' +
					'Do not pad the list with a weak or redundant variant just to add another entry — a shorter, accurate list is better than a longer one with filler. ' +
					'Remember,  a synonym is a term you could substitute for the concept in a sentence and mean the exact same thing — not a related field, a parent/broader field, or something that commonly overlaps with it. ' +
					'"Machine intelligence" is a synonym for "AI" because they mean the same thing; "automation" is not a synonym for "robotics" — it\'s a related but distinct field — so it should not appear as a synonym. ' +
					'For "methods": list genuinely distinct techniques or approaches associated with the concept, not several rephrasings of the same one, and not each other\'s abbreviations — do not include a separate entry if it abbreviates a method already listed. ' +
					'Avoid generic words that describe every academic paper rather than this specific topic — for example "research," "study," "analysis," or "paper" are never useful concepts, synonyms, or methods on their own. ' +
					'Keep each entry short — a few words, not a sentence.',
			},
			{
				role: 'user',
				content: `Topic: "${query}"`,
			},
		],
		response_format: {
			type: 'json_schema',
			json_schema: {
				type: 'object',
				properties: {
					topics: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								concept: { type: 'string' },
								synonyms: { type: 'array', items: { type: 'string' } },
								methods: { type: 'array', items: { type: 'string' } },
							},
							required: ['concept', 'synonyms', 'methods'],
						},
					},
				},
				required: ['topics'],
			},
		},
	});

	console.log(JSON.stringify(response.response, null, 2));

	return response.response;
}

/**
 * Example output: "What are the main topics and methods used in research papers related to AI x Cybersecurity"
 * {
 *   topics: [
 *     { concept: 'artificial intelligence', synonyms: ['AI', 'machine intelligence'],
 *       methods: ['machine learning', 'deep learning', 'neural networks'] },
 *     { concept: 'cybersecurity', synonyms: ['information security', 'computer security', 'network security'],
 *       methods: ['threat detection', 'intrusion detection', 'anomaly detection', 'malware analysis'] },
 *   ]
 * }
 *
 * Possible next step: methods as { name, aliases } so abbreviations are kept without duplicate entries,
 * e.g. { name: 'machine learning', aliases: ['ML'] }
 */
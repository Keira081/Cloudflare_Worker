export type TopicObject = {
	concept: string;
	synonyms: string[];
	methods: string[];
};

export type OntologyObject = {
	topic: TopicObject[];
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

	// console.log(response.response);

	console.log(JSON.stringify(response.response, null, 2));

	return response.response;
}

// ("list every genuinely distinct synonym or near-synonym researchers commonly use for this concept — don't pad with filler, but don't stop at the first one either.");

// query: Is there meaningful research combining large language models with formal verification?

// response: {
//   concepts: [ 'large language models', 'formal verification' ],
//   methods: [ 'model checking', 'proof assistants' ],
//   synonyms: [
//     'natural language processing',
//     'software verification',
//     'AI safety'
//   ]
// }
// ___________________________
// query: Is there a real research base on AI applications in cybersecurity, or is it mostly speculative/position papers?

// response:
// ___________________________
// query: How much overlap is there between mechanistic interpretability research and alignment research?

// response: {
//   concepts: [ 'mechanistic interpretability', 'alignment research' ],
//   methods: [ 'comparative analysis', 'literature review' ],
//   synonyms: [ 'explainability', 'value alignment', 'transparency' ]
// }

// query: What are the main topics and methods used in research papers related to AI x Cybersecurity

// {
//   topics: [
//     {
//       concept: "artificial intelligence",
//       synonyms: ["AI", "machine intelligence"],
//       methods: ["machine learning", "deep learning", "neural networks"]
//     },
//     {
//       concept: "cybersecurity",
//       synonyms: ["information security", "computer security", "network security"],
//       methods: ["threat detection", "intrusion detection", "anomaly detection", "malware analysis"]
//     }
//   ]
// }

// {
//   "topics": [
//     {
//       "concept": "AI",
//       "methods": [
//         {name: "machine learning", aliases: "ML"}
//         {name: "deep learning", aliases: "DL"}
//         {name: "natural language processing", aliases: "NLP"}
//       ],
//       "synonyms": [
//         "artificial intelligence",
//       ]
//     },
//     {
//       "concept": "robotics",
//       "methods": [
//         "computer vision",
//         "control systems",
//         "human-robot interaction"
//       ],
//       "synonyms": [
//         "robotics engineering",
//         "mechatronics",
//         "autonomous systems"
//       ]
//     }
//   ]
// }

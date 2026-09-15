/**
 * The LLM's job: translate a fuzzy natural-language topic into
 * a well-formed search query per source.
 */

export type SourceQueries = Record<string, string>;

export async function generateSourceQueries(ai: Ai, topic: string, sources: string[]): Promise<SourceQueries> {
	const response = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
		//                           @cf/meta/llama-4-scout-17b-16e-instruc
		messages: [
			{
				role: 'system',
				content:
					"You translate a research topic into a concise, well-formed search query for each given academic source. Keep each query short (a handful of keywords), suited to that source's search syntax conventions.",
			},
			{
				role: 'user',
				content: `Topic: "${topic}"\nSources: ${sources.join(', ')}`,
			},
		],
		response_format: {
			type: 'json_schema',
			json_schema: {
				type: 'object',
				properties: Object.fromEntries(sources.map((s) => [s, { type: 'string' }])),
				required: sources,
			},
		},
	});

	// console.log('response: ', response);
	console.log();

	return response.response;
}

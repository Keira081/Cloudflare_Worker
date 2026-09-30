const OPENALEX_API_BASE = 'https://api.openalex.org/works';

export async function getOpenAlexPopulationCount(query: string, mailto?: string): Promise<number> {
	const url = new URL(OPENALEX_API_BASE);
	url.searchParams.set('search', query);
	url.searchParams.set('per-page', '1'); // we only need the count, not real records
	if (mailto) url.searchParams.set('mailto', mailto); // joins the polite pool (set OPENALEX_MAILTO in .dev.vars)

	const response = await fetch(url.toString());

	if (response.status === 429) {
		throw new Error(`OpenAlex rate limit hit for query: "${query}"`);
	}

	const data = await response.json<{ meta: { count: number } }>();
	return data.meta.count;
}

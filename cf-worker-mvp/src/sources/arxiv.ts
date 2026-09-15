const ARXIV_API_BASE = 'http://export.arxiv.org/api/query';

export async function getArxivPopulationCount(query: string): Promise<number> {
	// turning the string into a url object makes it easier to
	// add the params into it correctly
	// rather than doing something like:
	// const url = ARXIV_API_BASE + `?search_query=all:${query}&start=.....`
	// it's just way cleaner and less error prone this way
	const url = new URL(ARXIV_API_BASE);
	// console.log('URL: ', url);
	url.searchParams.set('search_query', `all:${query}`);
	url.searchParams.set('start', '0');
	url.searchParams.set('max_results', '0');
	//console.log('URL: ', url);
	//console.log('URL -> String: ', url.toString());

	const response = await fetch(url.toString());
	const xml = await response.text();

	console.log('xml: ', xml);

	if (response.status === 429) {
		throw new Error(`arXiv rate limit hit for query: "${query}"`);
	}

	if (xml.includes('<title>Error</title>')) {
		throw new Error(`arXiv API returned an internal error for query: "${query}"`);
	}

	const population = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/);
	if (!population) {
		throw new Error('Could not parse totalResults from arXiv response :(');
	}

	console.log('population: ', population);

	return parseInt(population[1], 10);
}

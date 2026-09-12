const ARXIV_API_BASE = 'http://export.arxiv.org/api/query';

export async function getArxivPopulationCount(query: string): Promise<number> {
	// assuming turning the string into a url object makes it easier to
	// add the params into it correctly
	// rather than doing something like:
	// const url = ARXIV_API_BASE + `?search_query=all:${query}&start=.....`
	// it's just way cleaner and less error prone this way
	const url = new URL(ARXIV_API_BASE);
	console.log('URL: ', url);
	url.searchParams.set('search_query', `all:${query}`);
	url.searchParams.set('start', '0');
	url.searchParams.set('max_results', '0');
	console.log('URL: ', url);
	console.log('URL -> String: ', url.toString());

	const response = await fetch(url.toString());
	const xml = await response.text(); //  what's this do?

	const population = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/); // please explain tis regex, I get that it's looking for something like this: <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1000</opensearch:totalResults> (an example from the API site), but I ust dont understand how to right or read regex.Like for example is this part, [^>]*, saying that it doesn't really care what comes after as it's not a >?? (i.e as long as it's after opensearch:totalResults, anything up to a > is fine) but then you already have the  > at the end too so i'm confused)
	if (!population) {
		throw new Error('Could not parse totalResults from arXiv response :(');
	}
	console.log(population);

	return parseInt(population[1], 10); // I'm assuming population will return something like: <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1000</opensearch:totalResults>, if it finds it. so how does this not throw an error??
}

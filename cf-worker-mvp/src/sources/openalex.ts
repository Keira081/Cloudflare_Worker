export type Paper = {
	title: string;
	abstract: string;
	publicationYear: number;
	oaStatus: string;
	isOa: boolean;
	oaUrl: string | null;
};

type FetchedObject = {
	papers: Paper[];
	totalMatching: number; // OpenAlex's count of all works matching the query
	discardedNoAbstract: number;
	discardedDuplicates: number;
	exhaustedPop: boolean; // true once we've seen every matching work, meaning there's nothing left to fetch
};

type OpenAlexPaper = {
	title: string;
	abstract_inverted_index: Record<string, number[]> | null;
	publication_year: number;
	open_access: OpenAccess;
};

type OpenAccess = {
	is_oa: boolean;
	oa_status: string;
	oa_url: string | null;
	any_repository_has_fulltext: boolean;
};

export interface OpenAlexResponse {
	meta: { count: number };
	results: OpenAlexPaper[];
}

const OPENALEX_API_BASE = 'https://api.openalex.org/works';
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 3;

/**
 * Fetches up to BATCH_SIZE new papers, re-requesting (up to MAX_ATTEMPTS) to replace ones that
 * were discarded. Skips papers without abstracts and duplicates, both from earlier batches
 * (`seenTitles`) and within this batch (`reviewedTitles`), and counts why each was skipped.
 */
export async function uniqueOpenalexBatch(query: string, seenTitles: Set<string>, mailto?: string): Promise<FetchedObject> {
	let totalMatching = 0;
	let discardedNoAbstract = 0;
	let discardedDuplicates = 0;
	let exhaustedPop = false;
	let attempts = 0;
	let totalFetched = 0;

	const papers: Paper[] = [];
	const reviewedTitles = new Set<string>();

	while (papers.length < BATCH_SIZE && attempts < MAX_ATTEMPTS && !exhaustedPop) {
		const remaining = BATCH_SIZE - papers.length;
		const data = await fetchOpenAlexPapers(query, remaining, mailto);
		const results = data.results;

		for (const result of results) {
			const normalizedTitle = result.title.trim().toLowerCase();

			if (result.abstract_inverted_index == null) {
				discardedNoAbstract++;
				continue;
			} else if (seenTitles.has(normalizedTitle) || reviewedTitles.has(normalizedTitle)) {
				discardedDuplicates++;
				continue;
			}

			const abstract = reconstructAbstract(result.abstract_inverted_index);

			const paper: Paper = {
				title: result.title,
				abstract: abstract,
				publicationYear: result.publication_year,
				oaStatus: result.open_access.oa_status,
				isOa: result.open_access.is_oa,
				oaUrl: result.open_access.oa_url,
			};

			reviewedTitles.add(normalizedTitle);
			papers.push(paper);
		}

		totalFetched = papers.length + discardedDuplicates + discardedNoAbstract;
		totalMatching = data.meta.count;

		if (totalFetched >= totalMatching) {
			exhaustedPop = true;
		}

		attempts++;
	}

	return { totalMatching, papers, discardedNoAbstract, discardedDuplicates, exhaustedPop };
}

// One request for a random sample of the remaining works matching the query.
export async function fetchOpenAlexPapers(query: string, remaining: number, mailto?: string): Promise<OpenAlexResponse> {
	const url = new URL(OPENALEX_API_BASE);
	url.searchParams.set('search', query);
	url.searchParams.set('filter', 'has_abstract:true');
	url.searchParams.set('sample', String(remaining)); // random sample, not the API's default ordering
	url.searchParams.set('per-page', String(remaining));
	if (mailto) url.searchParams.set('mailto', mailto); // joins the polite pool (OPENALEX_MAILTO)
	url.searchParams.set('select', 'title,abstract_inverted_index,publication_year,open_access'); // only the fields we use

	console.log('url: ', url.toString());
	const response = await fetch(url.toString());

	if (response.status === 429) {
		throw new Error(`OpenAlex rate limit hit for query: "${query}"`);
	}
	if (!response.ok) {
		throw new Error(`OpenAlex request failed (${response.status}) for query: "${query}"`);
	}

	const data = await response.json<{
		meta: { count: number };
		results: OpenAlexPaper[];
	}>();

	return data;
}

// OpenAlex stores abstracts as an inverted index ({ word: [positions] }).
// This rebuilds the text by placing each word at its positions. Any gaps stay as '_'.
export function reconstructAbstract(invertedIndex: Record<string, number[]>): string {
	let highest = -1;
	for (const [_, position] of Object.entries(invertedIndex)) {
		position.sort((a, b) => a - b);
		const lastPos = position.at(-1);
		if (lastPos !== undefined && lastPos > highest) {
			highest = lastPos;
		}
	}
	const abstractWords = Array.from({ length: highest + 1 }, () => '_');

	for (const [word, position] of Object.entries(invertedIndex)) {
		for (const pos of position) {
			abstractWords[pos] = word;
		}
	}

	const fullAbstractText = abstractWords.join(' ');

	return fullAbstractText;
}

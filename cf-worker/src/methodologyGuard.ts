/**
 * How will we sample??
 * Problem with taking first X results from sources:
 *      API returns result in a certian order (likely most-recent-first)
 *      so it's not a random sample of everything they have on a related topic
 *      therefore taking firs x papers would likely overrepresent very new papers
 *      and underrepresent potentially foundational or other influential papers
 *      It wouldn't lead to an accurate represseentation of the actual trends in
 *      in the world
 *         reported by your tool would really be "whatever this specific API's ranking algorithm decided to show first" — a statement about a search engine's sorting logic, dressed up as a statement about the state of a research field.
 *
 *
 * Need a RANDOM sample
 *
 * Cochran's formula: n₀ = (Z² × p × (1-p)) / e²
 * Z - the z-score for your confidence level.
 * p - the estimated proportion of your population with whatever trait you're measuring.
 * e - your acceptable margin of error, as a decimal.
 * Questions it solves: What fraction of papers mention topic X
 * // Cochran's formula, standard 95% confidence, ±10% margin of error, p = 0.5
 *
 * How Do you determine margin of error?
 * - What's actually at stake if you're wron
 * - The cost of collecting more data
 *      * tighter margin gets exponentially more expensive snince e is squared in the denominator
 *
 * With known population:
 * n = n₀ / (1 + (n₀ - 1) / N)
 * Where N is the actual known population size for that stratum
 *
 */

/**
 * The Planner.
 * sources and sample size are both  determined by fixed config + Cochran's formula.
 *
 * Cochran's formula: n₀ = (Z² × p × (1-p)) / e²
 * standard 95% confidence, ±10% margin of error, p = 0.5
 */

type Plan = {
	sources: string[];
	sampleSize: number;
};

const SOURCES = ['arxiv', 'openalex', 'semanticscholar'];

// Cochran's formula, standard 95% confidence, ±10% margin of error, p = 0.5
const Z = 1.96;
const P = 0.5;
const E = 0.1;
//                                      (Z² × p × (1-p)) / e²
const COCHRAN_BASELINE = Math.ceil((Z ** 2 * P * (1 - P)) / E ** 2); // ≈ 97

export function buildPlan(): Plan {
	return {
		sources: SOURCES,
		sampleSize: COCHRAN_BASELINE,
	};
}

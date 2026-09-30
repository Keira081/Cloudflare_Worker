/**
 * Was the original approach- a fixed sample size from Cochran's formula.
 * It was replaced by saturation-based batching, because Cochran's formula tells you how many
 * random draws to take from a population you've already defined. It can't tell you whether
 * you've found enough of the relevant papers.
 *
 * Why random sampling: APIs return results in a set order (e.g. newest first), so taking the
 * first X papers overrepresents new work and underrepresents foundational papers.
 *
 * Cochran's formula: n₀ = (Z² × p × (1 − p)) / e²
 *   Z = z-score for the confidence level, p = expected proportion (0.5 is the most conservative),
 *   e = margin of error. n grows with 1/e², so halving e quadruples the sample.
 * Finite population correction (known population N): n = n₀ / (1 + (n₀ − 1) / N)
 */

type Plan = {
	sources: string[];
	sampleSize: number;
};

const SOURCES = ['arxiv', 'openalex', 'semanticscholar'];

// 95% confidence, ±5% margin of error, p = 0.5
const Z = 1.96;
const P = 0.5;
const E = 0.05;
const COCHRAN_BASELINE = Math.ceil((Z ** 2 * P * (1 - P)) / E ** 2); // = 385 (would be 97 at E = 0.10)

export function buildPlan(): Plan {
	return {
		sources: SOURCES,
		sampleSize: COCHRAN_BASELINE,
	};
}

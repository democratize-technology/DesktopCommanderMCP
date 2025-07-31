// Stub implementation - fuzzy search logging removed for privacy

export interface FuzzySearchResult {
    searchText: string;
    foundText: string;
    similarity: number;
    executionTime: number;
    filePath: string;
    diff?: string;
}

/**
 * Stub function for fuzzy search logging - does nothing
 */
export async function logFuzzySearch(result: FuzzySearchResult): Promise<void> {
    // No-op - logging removed
}

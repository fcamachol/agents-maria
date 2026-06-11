// ============================================
// Maria CEA SDK - Name Matching Service
// Extracted from tools.ts — handles fuzzy name
// matching for contract holder verification
// ============================================

export function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Strip diacritical marks (a->a, n->n, etc.)
        .replace(/\s+/g, " ")
        .trim();
}

export function bigramSimilarity(a: string, b: string): number {
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

    const getBigrams = (s: string): Set<string> => {
        const bigrams = new Set<string>();
        for (let i = 0; i < s.length - 1; i++) {
            bigrams.add(s.substring(i, i + 2));
        }
        return bigrams;
    };

    const bigramsA = getBigrams(a);
    const bigramsB = getBigrams(b);
    let intersection = 0;
    for (const bg of bigramsA) {
        if (bigramsB.has(bg)) intersection++;
    }

    // Dice coefficient
    return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

export function matchName(userInput: string, holderName: string): { match: boolean; confidence: number; method: string } {
    const normalizedInput = normalizeName(userInput);
    const normalizedHolder = normalizeName(holderName);

    if (!normalizedInput || !normalizedHolder) {
        return { match: false, confidence: 0, method: "empty" };
    }

    // 1. Exact full match after normalization
    if (normalizedInput === normalizedHolder) {
        return { match: true, confidence: 1.0, method: "exact" };
    }

    // 2. Substring match (user's input found in holder name)
    if (normalizedHolder.includes(normalizedInput)) {
        return { match: true, confidence: 0.9, method: "substring" };
    }

    // 3. Word-level exact match (any word >=3 chars matches)
    const inputWords = normalizedInput.split(" ").filter(w => w.length >= 3);
    const holderWords = normalizedHolder.split(" ").filter(w => w.length >= 3);

    for (const iw of inputWords) {
        for (const hw of holderWords) {
            if (iw === hw) {
                return { match: true, confidence: 0.85, method: "word_match" };
            }
        }
    }

    // 4. Fuzzy word match (Dice >= 0.65 on any word pair)
    let bestScore = 0;
    for (const iw of inputWords) {
        for (const hw of holderWords) {
            if (iw.length < 5 || hw.length < 5) continue;
            const score = bigramSimilarity(iw, hw);
            if (score > bestScore) bestScore = score;
        }
    }

    if (bestScore >= 0.75) {
        return { match: true, confidence: bestScore, method: "fuzzy_word" };
    }

    // 5. No match
    return { match: false, confidence: bestScore, method: "none" };
}

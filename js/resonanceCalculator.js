class ResonanceCalculator {
    constructor() {
        this.results = [];
    }

    calculate(baseFreq, mode, customMult = 1.5, numResults = 6) {
        this.results = [];
        
        for (let i = 1; i <= numResults; i++) {
            let freq = 0;
            switch(mode) {
                case 'harmonic':
                    freq = baseFreq * i;
                    break;
                case 'odd':
                    freq = baseFreq * (2 * i - 1);
                    break;
                case 'plate':
                    freq = baseFreq * (i * i);
                    break;
                case 'custom':
                    freq = baseFreq * Math.pow(customMult, i - 1);
                    break;
                default:
                    freq = baseFreq * i;
            }
            this.results.push(parseFloat(freq.toFixed(2)));
        }
        return this.results;
    }

    detectMatch(micFreq) {
        if (this.results.length === 0 || micFreq < 10) return null;
        
        let bestMatch = null;
        let minDiff = Infinity;

        for (let target of this.results) {
            const diff = Math.abs(micFreq - target);
            if (diff < minDiff) {
                minDiff = diff;
                bestMatch = target;
            }
        }

        // Within 2% threshold
        const threshold = bestMatch * 0.02;
        if (minDiff < threshold) {
            const confidence = Math.max(0, 100 - (minDiff / threshold * 100));
            return {
                target: bestMatch,
                diff: minDiff,
                confidence: confidence.toFixed(1)
            };
        }

        return null;
    }
}

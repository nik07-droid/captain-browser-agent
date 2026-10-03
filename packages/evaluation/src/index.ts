export interface ConfusionMetrics { truePositives: number; falsePositives: number; falseNegatives: number; precisionPercent: number; recallPercent: number; f1Percent: number }
export interface BenchmarkCaseResult { id: string; passed: boolean; visual: ConfusionMetrics; privacy: ConfusionMetrics; latencyMs: number }

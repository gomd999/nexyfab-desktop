import { MANUFACTURING_CORPUS_V1, summarizeCorpusSources } from '../src/lib/ai/manufacturingCorpus';
import { buildManufacturingKpiReport } from '../src/lib/ai/manufacturingKpi';

const report = buildManufacturingKpiReport(MANUFACTURING_CORPUS_V1, []);

console.log(JSON.stringify({
  note: 'No governed execution records have been imported yet. Null metrics mean not measured.',
  corpusSources: summarizeCorpusSources(MANUFACTURING_CORPUS_V1),
  ...report,
}, null, 2));

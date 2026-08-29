import { writeRegressionCorpus } from "../src/lib/regression/corpus";

writeRegressionCorpus("documents").then(() => {
  console.log("Wrote documents/fixtures and documents/expected-findings.json");
});

import { writeRegressionCorpus } from "../src/lib/regression/corpus";

writeRegressionCorpus("docs").then(() => {
  console.log("Wrote docs/test-files");
});

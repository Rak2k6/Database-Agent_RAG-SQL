import { writeFile } from "node:fs/promises";
import path from "node:path";
import { processStoredDocument } from "./server/src/document-processing.ts";

async function main() {
  const files = [
    "doc_8717f437-d4f8-44e5-9234-fa2bd21ee996_Cloud_Infrastructure_Migration_Status_Report.pdf",
    "doc_fe7572a8-fe7b-4f26-944e-8066704e3f85_Northstar_Project_Brief_Test.pdf",
  ];

  for (const filename of files) {
    console.log(`\n--- Testing: ${filename} ---`);

    const result = await processStoredDocument(
      {
        documentId: `validation-${filename}`,
        projectId: null,
        originalFilename: filename,
        filePath: `/uploads/${filename}`,
      },
      { uploadDirectory: path.resolve("server/uploads") },
    );

    if (result.processingStatus !== "processed") {
      console.log("Status: FAILED");
      console.log("Error:", result.extractionError);
      continue;
    }

    const text = result.chunks.map((chunk) => chunk.text).join("\n\n");
    const output = path.resolve(
      "server/data",
      `${path.parse(filename).name}-extraction.txt`,
    );

    await writeFile(output, text, "utf8");

    console.log("Status: SUCCESS");
    console.log("Chunks:", result.chunks.length);
    console.log("Characters:", text.length);
    console.log("SHA-256:", result.sourceHash);
    console.log("Output:", output);
    console.log("Preview:\n", text.slice(0, 1200));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

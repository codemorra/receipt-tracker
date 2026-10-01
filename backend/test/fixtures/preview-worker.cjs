const readline = require("node:readline");

if (process.argv[2] === "ignore-term") process.on("SIGTERM", () => {});

if (process.argv[2] === "fail-recovery") {
  const fs = require("node:fs");
  if (fs.existsSync(process.argv[3])) process.exit(2);
  fs.writeFileSync(process.argv[3], "started");
}
setTimeout(
  () => {
    process.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  },
  Number(process.argv[2]) || 0,
);

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.originalPath === "hang-request") return;
  if (request.originalPath === "crash") {
    process.exit(2);
  }
  if (request.originalPath === "request-error") {
    process.stdout.write(
      JSON.stringify({
        requestId: request.requestId,
        status: "error",
        error: "Invalid image",
      }) + "\n",
    );
    return;
  }
  if (request.type === "process") {
    process.stdout.write(
      JSON.stringify({
        requestId: request.requestId,
        status: "ok",
        width: request.rotation === 90 || request.rotation === 270 ? 200 : 100,
        height: request.rotation === 90 || request.rotation === 270 ? 100 : 200,
        plainText: "RECEIPT",
        ocrDurationMs: 12.5,
        lines: [
          { index: 0, text: "RECEIPT", confidence: 0.95, box: [0, 0, 1, 1] },
        ],
        rows: [
          {
            rowIndex: 0,
            segments: [{ text: "RECEIPT", x: 0 }],
            lineIndexes: [0],
          },
        ],
      }) + "\n",
    );
    return;
  }
  process.stdout.write(
    JSON.stringify({
      requestId: request.requestId,
      status: "ok",
      width: Number(request.originalPath),
      height: 200,
      rotation: 0,
      suggestedCorners: {
        topLeft: [0, 0],
        topRight: [1, 0],
        bottomRight: [1, 1],
        bottomLeft: [0, 1],
      },
    }) + "\n",
  );
});

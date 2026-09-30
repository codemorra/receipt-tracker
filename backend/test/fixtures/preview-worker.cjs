const readline = require("node:readline");

process.stdout.write(JSON.stringify({ type: "ready" }) + "\n");

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.originalPath === "crash") {
    process.exit(2);
  }
  if (request.type === "process") {
    process.stdout.write(
      JSON.stringify({
        requestId: request.requestId,
        status: "ok",
        width: 100,
        height: 200,
        plainText: "RECEIPT",
        ocrDurationMs: 12.5,
        lines: [{ index: 0, text: "RECEIPT", confidence: 0.95, box: [0, 0, 1, 1] }],
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
      suggestedCorners: {
        topLeft: [0, 0],
        topRight: [1, 0],
        bottomRight: [1, 1],
        bottomLeft: [0, 1],
      },
    }) + "\n",
  );
});

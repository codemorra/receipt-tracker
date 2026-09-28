const readline = require("node:readline");

process.stdout.write(JSON.stringify({ type: "ready" }) + "\n");

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.originalPath === "crash") {
    process.exit(2);
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

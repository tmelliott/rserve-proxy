const path = require("path");

// Resolve modules from rserve-ts
const rservePath = path.resolve(__dirname, "../../rserve-ts");
const RserveClient = require(path.join(rservePath, "dist/index.js"));
const { Robj } = RserveClient;
const { z } = require(path.join(rservePath, "node_modules/zod"));

// Node doesn't have WebSocket or window globally — provide polyfills
global.WebSocket = require(path.join(rservePath, "node_modules/ws"));
global.window = global;

// Default: Traefik dev port (8880) with app slug path
// e.g. RSERVE_HOST=http://127.0.0.1:8880/test-app
const HOST = process.env.RSERVE_HOST || "http://127.0.0.1:8880/test-app";

async function main() {
  console.log(`Connecting to Rserve at ${HOST} ...`);

  const R = await RserveClient.default.create({ host: HOST });
  console.log("Connected! OCAP mode:", R.is_ocap_mode());

  // Get the OCAP functions exposed by testapp.R
  const app = await R.ocap({
    add: Robj.ocap([z.number(), z.number()], Robj.numeric(1)),
    greet: Robj.ocap([z.string()], Robj.character(1)),
    test: Robj.ocap([z.number()], Robj.numeric(1)),
  });

  // Test: add
  const sum = await app.add(3, 4);
  console.log("add(3, 4) =", sum);
  console.assert(sum === 7, `Expected 7, got ${sum}`);

  // Test: greet
  const greeting = await app.greet("World");
  console.log('greet("World") =', greeting);
  console.assert(
    greeting === "Hello, World!",
    `Expected "Hello, World!", got "${greeting}"`
  );

  // Test: test (always returns 2)
  const t = await app.test(0);
  console.log("test(0) =", t);
  console.assert(t === 2, `Expected 2, got ${t}`);

  console.log("\nAll tests passed!");
  R.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

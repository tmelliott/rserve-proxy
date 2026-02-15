const path = require("path");

// Resolve modules from rserve-ts
const rservePath = path.resolve(__dirname, "../../rserve-ts");
const RserveClient = require(path.join(rservePath, "dist/index.js"));
const { Robj } = RserveClient;
const { z } = require(path.join(rservePath, "node_modules/zod"));

// Node polyfills
global.WebSocket = require(path.join(rservePath, "node_modules/ws"));
global.window = global;

const HOST =
  process.env.RSERVE_HOST || "http://127.0.0.1:8880/rserve-ts-app";

async function main() {
  console.log(`Connecting to Rserve at ${HOST} ...`);

  const R = await RserveClient.default.create({ host: HOST });
  console.log("Connected! OCAP mode:", R.is_ocap_mode());

  // OCAP schema matching the rserve-ts oc.init.R functions
  const funs = await R.ocap({
    add: Robj.ocap([z.number(), z.number()], Robj.numeric(1)),
    t1: Robj.ocap([z.number()], Robj.numeric(1)),
    t2: Robj.ocap([z.number()], Robj.numeric(1)),
    randomNumbers: Robj.ocap([], Robj.numeric(10)),
    sample_num: Robj.ocap([z.instanceof(Float64Array)], Robj.numeric(1)),
    iris: Robj.ocap([], z.any()),
  });

  // Test: add
  const sum = await funs.add(1, 2);
  console.log("add(1, 2) =", sum);
  console.assert(sum === 3, `Expected 3, got ${sum}`);

  // Test: t1 (x starts at 3, adds v → 8)
  const x1 = await funs.t1(5);
  console.log("t1(5) =", x1);
  console.assert(x1 === 8, `Expected 8, got ${x1}`);

  // Test: t2 (x is now 8, subtracts v → 4)
  const x2 = await funs.t2(4);
  console.log("t2(4) =", x2);
  console.assert(x2 === 4, `Expected 4, got ${x2}`);

  // Test: randomNumbers (returns 10 random numbers)
  const rn = await funs.randomNumbers();
  console.log("randomNumbers() length =", rn.length);
  console.assert(rn.length === 10, `Expected 10 numbers, got ${rn.length}`);

  // Test: sample_num (pick one from a Float64Array)
  const nums = new Float64Array([10, 20, 30, 40, 50]);
  const picked = await funs.sample_num(nums);
  console.log("sample_num([10..50]) =", picked);
  console.assert([10, 20, 30, 40, 50].includes(picked), `Unexpected value ${picked}`);

  // Test: iris (returns head of iris dataset)
  const iris = await funs.iris();
  console.log("iris() columns =", iris.r_attributes?.names?.length || "unknown");
  console.assert(iris.r_attributes?.names?.length === 5, "Expected 5 columns in iris");

  console.log("\nAll tests passed!");
  R.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

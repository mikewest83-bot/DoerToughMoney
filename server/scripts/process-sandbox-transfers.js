// Sandbox-only: simulate ACH settlement of all pending transfers (same as the
// "Process bank transfers" button in the Dwolla sandbox dashboard). Dwolla
// then fires transfer_completed webhooks at the app.
import { dwolla } from "../dwolla/index.js";

const res = await dwolla.post("sandbox-simulations", {});
console.log("sandbox-simulations status:", res.status);

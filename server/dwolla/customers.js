// dwolla/customers.js
// Create Verified Customers (personal) and read their KYC status.
// Every even user is a Verified Customer so they can both send and receive.
import { dwolla } from "./client.js";

/**
 * Create a Verified personal Customer. Dwolla runs its CIP/KYC on creation.
 * @returns {string} the customer resource URL (persist this on your User row)
 */
export async function createVerifiedCustomer(user) {
  const res = await dwolla.post("customers", {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    type: "personal",
    address1: user.address1,
    city: user.city,
    state: user.state, // 2-letter
    postalCode: user.postalCode,
    dateOfBirth: user.dateOfBirth, // "YYYY-MM-DD"
    ssn: user.ssn, // per Dwolla's current requirement (often full SSN for personal verified)
  });
  return res.headers.get("location");
}

/**
 * Read current verification status.
 * @returns {"verified"|"retry"|"document"|"suspended"|string}
 */
export async function getCustomerStatus(customerUrl) {
  const res = await dwolla.get(customerUrl);
  return res.body.status;
}

/**
 * Resubmit a customer stuck in "retry" (Dwolla wants corrected/full info).
 */
export async function retryCustomer(customerUrl, user) {
  await dwolla.post(customerUrl, {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    type: "personal",
    address1: user.address1,
    city: user.city,
    state: user.state,
    postalCode: user.postalCode,
    dateOfBirth: user.dateOfBirth,
    ssn: user.ssn, // full SSN required on retry
  });
}

/**
 * Upload an identifying document when status === "document".
 * `file` is a Buffer/stream; documentType e.g. "license" | "passport" | "idCard".
 */
export async function uploadDocument(customerUrl, documentType, file, filename) {
  const body = new FormData();
  body.append("documentType", documentType);
  body.append("file", new Blob([file]), filename);
  const res = await dwolla.post(`${customerUrl}/documents`, body);
  return res.headers.get("location");
}

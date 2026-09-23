// api.js - API helper functions
// Written by the assistant

// Fetch chart rows from the server
export async function fetchRows(url) {
  // call fetch
  const res = await fetch(url);
  // check the response
  if (!res.ok) {
    // throw an error
    throw new Error("HTTP " + res.status);
  }
  // return the json
  return res.json();
}

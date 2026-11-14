
const OUTLAYER_BASE_URL = "https://testnet-api.outlayer.ai";

function getHeaders() {
  const apiKey = process.env.OUTLAYER_API_KEY;

  if (!apiKey) {
    throw new Error("OUTLAYER_API_KEY is not configured.");
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function readResponse(response) {
  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  return {
    ok: response.ok,
    httpStatus: response.status,
    data,
  };
}

export async function submitNearTransfer({ to, amount }) {
  const response = await fetch(
    `${OUTLAYER_BASE_URL}/wallet/v1/transfer`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ to, amount }),
    }
  );

  return readResponse(response);
}

export async function getOutlayerRequest(requestId) {
  if (
    typeof requestId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(requestId)
  ) {
    throw new Error("Invalid OutLayer request ID.");
  }

  const response = await fetch(
    `${OUTLAYER_BASE_URL}/wallet/v1/requests/${encodeURIComponent(requestId)}`,
    {
      method: "GET",
      headers: getHeaders(),
    }
  );

  return readResponse(response);
}
export async function getOutlayerApproval(approvalId) {
  if (
    typeof approvalId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(approvalId)
  ) {
    throw new Error("Invalid OutLayer approval ID.");
  }

  const response = await fetch(
    `${OUTLAYER_BASE_URL}/wallet/v1/approval/${encodeURIComponent(approvalId)}`,
    {
      method: "GET",
      headers: getHeaders(),
    }
  );

  return readResponse(response);
}

export async function getOutlayerNearAddress() {
  const response = await fetch(
    `${OUTLAYER_BASE_URL}/wallet/v1/address?chain=near`,
    {
      method: "GET",
      headers: getHeaders(),
    }
  );

  return readResponse(response);
}

export async function getOutlayerNearBalance() {
  const response = await fetch(
    `${OUTLAYER_BASE_URL}/wallet/v1/balance?chain=near`,
    {
      method: "GET",
      headers: getHeaders(),
    }
  );

  return readResponse(response);
}
export async function getOutlayerBinding() {
  const response = await fetch(
    `${OUTLAYER_BASE_URL}/wallet/v1/binding`,
    {
      method: "GET",
      headers: getHeaders(),
    }
  );

  return readResponse(response);
}
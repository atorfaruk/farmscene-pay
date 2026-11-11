
const REEVOL_MCP_URL = "https://source.reevol.com/mcp";

async function parseMcpResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream")) {
    const body = await response.text();

    const dataLines = body
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);

    const messages = dataLines.map((line) => JSON.parse(line));

    const message = messages.find(
      (item) => item.result || item.error
    ) || messages.at(-1);

    if (!message) {
      throw new Error("Reevol returned an empty response.");
    }

    return message;
  }

  return response.json();
}

async function callReevolTool(name, args) {
  const response = await fetch(REEVOL_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Reevol request failed: HTTP ${response.status}`);
  }

  const payload = await parseMcpResponse(response);

  if (payload?.error) {
    throw new Error(
      payload.error.message || "Reevol MCP request failed."
    );
  }

  if (payload?.result?.isError) {
    throw new Error(`Reevol tool failed: ${name}`);
  }

  return payload?.result;
}

function parseTextContent(result) {
  for (const item of result?.content || []) {
    if (item.type !== "text" || !item.text) continue;

    try {
      return JSON.parse(item.text);
    } catch {
      continue;
    }
  }

  return null;
}

function extractSupplierRecords(result) {
  const structured = result?.structuredContent;

  if (Array.isArray(structured)) return structured;

  for (const key of ["suppliers", "results", "matches", "items"]) {
    if (Array.isArray(structured?.[key])) {
      return structured[key];
    }
  }

  const parsed = parseTextContent(result);

  if (Array.isArray(parsed)) return parsed;

  for (const key of ["suppliers", "results", "matches", "items"]) {
    if (Array.isArray(parsed?.[key])) {
      return parsed[key];
    }
  }

  return [];
}

async function getFullSupplierProfile(slug) {
  if (!slug) return null;

  try {
    const result = await callReevolTool("get_supplier", { slug });
    return parseTextContent(result);
  } catch (error) {
    console.warn(
      `Could not retrieve Reevol profile for ${slug}:`,
      error.message
    );

    return null;
  }
}

function normalizeSupplier(searchRecord, fullProfile) {
  const item = fullProfile || searchRecord;

  const officialWebsite = item.websitePublic || null;

  return {
    name:
      item.legalNameEn ||
      searchRecord.legalNameEn ||
      searchRecord.name ||
      null,

    website: officialWebsite
      ? officialWebsite.startsWith("http")
        ? officialWebsite
        : `https://${officialWebsite}`
      : null,

    country:
      item.hqCountry ||
      searchRecord.hqCountry ||
      null,

    location:
      item.hqCity ||
      item.hqRegion ||
      searchRecord.hqCity ||
      null,

    description:
      item.summary ||
      item.matchExplanation ||
      searchRecord.matchExplanation ||
      "",

    source:
      item.url ||
      searchRecord.url ||
      null,

    products: [],

    // A Reevol result is a discovery lead, not an independently
    // verified supplier.
    verificationStatus: "unverified",

    reevolProfile: item,
  };
}

// Normalize company names for comparison.
function normalizeCompanyName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(limited|ltd|incorporated|inc|corporation|corp|company|co)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Extract a comparable website domain.
function normalizeDomain(value) {
  if (!value) return null;

  try {
    const url = new URL(
      value.startsWith("http") ? value : `https://${value}`
    );

    return url.hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizeCountry(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .trim();
}

function sameSupplier(first, second) {
  const firstDomain = normalizeDomain(first.website);
  const secondDomain = normalizeDomain(second.website);

  // Matching official domains are the strongest duplicate signal.
  if (firstDomain && secondDomain && firstDomain === secondDomain) {
    return true;
  }

  const firstName = normalizeCompanyName(first.name);
  const secondName = normalizeCompanyName(second.name);

  const firstCountry = normalizeCountry(first.country);
  const secondCountry = normalizeCountry(second.country);

  // Never merge same-name companies across different countries.
  return Boolean(
    firstName &&
    secondName &&
    firstCountry &&
    secondCountry &&
    firstName === secondName &&
    firstCountry === secondCountry
  );
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function mergeAgriculturalCategories(first = [], second = []) {
  const merged = new Map();

  for (const item of [...first, ...second]) {
    if (!item?.category) continue;

    const existing = merged.get(item.category);

    if (!existing) {
      merged.set(item.category, {
        ...item,
        keywordEvidence: [...(item.keywordEvidence || [])],
        hsCodeEvidence: [...(item.hsCodeEvidence || [])],
      });

      continue;
    }

    existing.keywordEvidence = [
      ...existing.keywordEvidence,
      ...(item.keywordEvidence || []),
    ];

    existing.hsCodeEvidence = [
      ...existing.hsCodeEvidence,
      ...(item.hsCodeEvidence || []),
    ];

    existing.keywordEvidence = uniqueValues(
      existing.keywordEvidence.map((entry) =>
        typeof entry === "string"
          ? entry
          : JSON.stringify(entry)
      )
    ).map((entry) => {
      try {
        return JSON.parse(entry);
      } catch {
        return entry;
      }
    });

    existing.hsCodeEvidence = uniqueValues(
      existing.hsCodeEvidence
    );
  }

  return [...merged.values()];
}

function mergeSuppliers(existing, incoming) {
  const mergedCategories = mergeAgriculturalCategories(
    existing.agriculturalCategories,
    incoming.agriculturalCategories
  );

  const hsCodes = uniqueValues([
    ...(existing.agriculturalEvidence?.hsCodes || []),
    ...(incoming.agriculturalEvidence?.hsCodes || []),
  ]);

  return {
    ...existing,

    // Fill missing information without replacing existing details.
    name: existing.name || incoming.name,
    website: existing.website || incoming.website,
    country: existing.country || incoming.country,
    location: existing.location || incoming.location,
    description: existing.description || incoming.description,
    source: existing.source || incoming.source,

    products: uniqueValues([
      ...(existing.products || []),
      ...(incoming.products || []),
    ]),

    agriculturalCategories: mergedCategories,

    agriculturalRelevance:
      existing.agriculturalRelevance === "evidence_found" ||
      incoming.agriculturalRelevance === "evidence_found"
        ? "evidence_found"
        : mergedCategories.length
          ? "needs_review"
          : "unrelated",

    agriculturalEvidence: {
      ...(existing.agriculturalEvidence || {}),
      ...(incoming.agriculturalEvidence || {}),
      hsCodes,
    },

    // Do not upgrade verification during deduplication.
    verificationStatus: "unverified",

    reevolProfiles: [
      ...(existing.reevolProfiles || [
        existing.reevolProfile,
      ].filter(Boolean)),
      ...(incoming.reevolProfiles || [
        incoming.reevolProfile,
      ].filter(Boolean)),
    ],
  };
}

// Deduplicate results after agricultural classification.
export function deduplicateSuppliers(suppliers = []) {
  const uniqueSuppliers = [];

  for (const supplier of suppliers) {
    const duplicateIndex = uniqueSuppliers.findIndex(
      (existing) => sameSupplier(existing, supplier)
    );

    if (duplicateIndex === -1) {
      uniqueSuppliers.push({
        ...supplier,
        reevolProfiles: [
          ...(supplier.reevolProfiles || [
            supplier.reevolProfile,
          ].filter(Boolean)),
        ],
      });
    } else {
      uniqueSuppliers[duplicateIndex] = mergeSuppliers(
        uniqueSuppliers[duplicateIndex],
        supplier
      );
    }
  }

  return uniqueSuppliers;
}

export async function searchReevolSuppliers(product, limit = 8) {
  const result = await callReevolTool(
    "match_suppliers_by_brief",
    {
      brief:
        `Find manufacturers, distributors, wholesalers and retailers ` +
        `supplying ${product} for agricultural use worldwide. ` +
        `Search globally without restricting results to a buyer country. ` +
        `Return companies with relevant product evidence and official websites.`,
     limit,
    }
  );

  const records = extractSupplierRecords(result);

  const enrichedRecords = await Promise.all(
    records.map(async (record) => {
      const profile = await getFullSupplierProfile(record.slug);

      return normalizeSupplier(record, profile);
    })
  );

  return {
    provider: "reevol",
    results: enrichedRecords.filter((item) => item.name),
  };
}

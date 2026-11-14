
import { searchYouSuppliers } from "../youSearch.js";
import { searchTavily } from "./tavilySearch.js";
import { searchExa } from "./exaSearch.js";
import { searchBrightData } from "./brightDataSearch.js";

const DEFAULT_MIN_RESULTS = 15;
const MAX_RESULTS = 40;

function extractYouResults(result) {
  if (result?.isError) {
    throw new Error("You.com returned a search error.");
  }

  let data = result?.structuredContent;

  if (!data && result?.content) {
    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text || "")
      .join("\n");

    try {
      data = JSON.parse(text);
    } catch {
      data = { rawText: text };
    }
  }

  const results =
    data?.results?.web ??
    data?.web?.contents ??
    data?.results;

  if (Array.isArray(results)) return results;

  if (data?.rawText) {
    return [
      ...data.rawText.matchAll(
        /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
      ),
    ].map((match) => ({
      title: match[1],
      url: match[2],
      description: data.rawText,
    }));
  }

  return [];
}

function normalizeUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    parsed.hash = "";

    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ].forEach((key) => parsed.searchParams.delete(key));

    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return null;
  }
}

function normalizeResults(results, provider) {
  if (!Array.isArray(results)) return [];

  return results
    .map((item) => {
      const url = normalizeUrl(item.url || item.link);

      const description = [
        item.description,
        item.content,
        item.snippet,
        ...(Array.isArray(item.highlights)
          ? item.highlights
          : []),
        ...(Array.isArray(item.snippets)
          ? item.snippets
          : []),
        ...(Array.isArray(item.contents?.highlights)
          ? item.contents.highlights
          : []),
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 6000);

      return {
        title: item.title || item.name || "Supplier lead",
        url,
        description,
        provider,
        source: url,
        evidence: {
          sourceTitle: item.title || item.name || null,
          sourceUrl: url,
          searchProvider: provider,
        },
      };
    })
    .filter(
  (item) =>
    item.url && !isObviousNonSupplierSource(item)
);
}
function isObviousNonSupplierSource(item) {
  const title = String(item.title || "").toLowerCase();
  const url = String(item.url || "").toLowerCase();
  const description = String(item.description || "").toLowerCase();

  const buyerListing =
    /\/buyers?(?:\/|$)/i.test(url) ||
    /\b(buy leads?|buyer requests?|looking to buy|wanted to buy)\b/i.test(
      `${title} ${description}`
    );

  const irrelevantPage =
  /\b(market research report|industry statistics|market forecast|market size report|top .{0,40} companies|leading .{0,40} companies|companies .{0,40} world)\b/i.test(
    title
  );

  return buyerListing || irrelevantPage;
}

function getProviderConfiguration() {
  const freeFirst = (
    process.env.SUPPLIER_FREE_FIRST_PROVIDERS || ""
  )
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  return freeFirst;
}

function deduplicateResults(results) {
  const unique = new Map();

  for (const item of results) {
    const key = normalizeUrl(item.url);

    if (!key) continue;

    const existing = unique.get(key);

    if (!existing || item.description.length > existing.description.length) {
      unique.set(key, item);
    }
  }

  return [...unique.values()];
}

async function runProviders(providers, query, location) {
  const outcomes = await Promise.allSettled(
    providers.map(async (provider) => {
      console.log(`Searching suppliers with ${provider.name}...`);

      const results = await provider.search(query, location);

      console.log(
        `${provider.name} returned ${results.length} usable results.`
      );

      return {
        provider: provider.name,
        results,
      };
    })
  );

  const results = [];
  const errors = [];
  const successfulProviders = [];

  outcomes.forEach((outcome, index) => {
    const providerName = providers[index].name;

    if (outcome.status === "fulfilled") {
      successfulProviders.push(providerName);
      results.push(...outcome.value.results);
    } else {
      const message =
        outcome.reason?.message || "Unknown provider error.";

      console.error(`${providerName} search failed:`, message);

      errors.push({
        provider: providerName,
        error: message,
      });
    }
  });

  return {
    results,
    errors,
    successfulProviders,
  };
}

export async function searchSupplierWeb(
  query,
  location,
  options = {}
) {
  if (!query?.trim()) {
    throw new Error("A supplier search query is required.");
  }

  if (!location?.trim()) {
    throw new Error("A delivery destination is required.");
  }

  const destination = location.trim();

  const globalQuery = [
    query.trim(),
    "Search suppliers worldwide across all countries and regions.",
    `Delivery destination: ${destination}.`,
    "Do not limit supplier discovery to the destination country.",
    "Include manufacturers, distributors, wholesalers, retailers and marketplaces.",
    "Return company names, official websites, countries and relevant product evidence.",
    "Do not invent prices, stock, certifications or shipping availability.",
  ].join(" ");

  const providers = [
    {
      name: "You.com",
      search: async (q) =>
        normalizeResults(
          extractYouResults(await searchYouSuppliers(q)),
          "You.com"
        ),
    },
    {
      name: "Tavily",
      search: async (q) =>
        normalizeResults(await searchTavily(q), "Tavily"),
    },
    {
      name: "Exa",
      search: async (q) =>
        normalizeResults(await searchExa(q), "Exa"),
    },
    {
      name: "Bright Data",
      search: async (q, destination) =>
        normalizeResults(
          await searchBrightData(q, destination),
          "Bright Data"
        ),
    },
  ];

  const freeFirstNames = getProviderConfiguration();

  const freeFirstProviders = providers.filter((provider) =>
    freeFirstNames.includes(provider.name.toLowerCase())
  );

  const fallbackProviders = providers.filter(
    (provider) =>
      !freeFirstNames.includes(provider.name.toLowerCase())
  );

  const minResults = Math.max(
    1,
    Number(options.minResults) || DEFAULT_MIN_RESULTS
  );

  const allResults = [];
  const allErrors = [];
  const successfulProviders = [];

  // STAGE 1: Configured free-first providers.
  if (freeFirstProviders.length) {
    const firstPass = await runProviders(
      freeFirstProviders,
      globalQuery,
      destination
    );

    allResults.push(...firstPass.results);
    allErrors.push(...firstPass.errors);
    successfulProviders.push(...firstPass.successfulProviders);
  }

  let uniqueResults = deduplicateResults(allResults);

  // STAGE 2: Other providers only when more leads are needed.
  if (
    fallbackProviders.length &&
    uniqueResults.length < minResults
  ) {
    const secondPass = await runProviders(
      fallbackProviders,
      globalQuery,
      destination
    );

    allResults.push(...secondPass.results);
    allErrors.push(...secondPass.errors);
    successfulProviders.push(...secondPass.successfulProviders);

    uniqueResults = deduplicateResults(allResults);
  }

  const finalResults = uniqueResults.slice(
    0,
    Math.min(MAX_RESULTS, Number(options.limit) || MAX_RESULTS)
  );

  return {
    provider: successfulProviders.length
      ? successfulProviders.join(", ")
      : null,

    successfulProviders: [...new Set(successfulProviders)],

    strategy: {
      supplierCoverage: "worldwide",
      databaseAccess: "free_first",
      destination,
      freeFirstProviders: freeFirstProviders.map((p) => p.name),
      fallbackProviders: fallbackProviders.map((p) => p.name),
      fallbackUsed:
        fallbackProviders.length > 0 &&
        uniqueResults.length > 0 &&
        !freeFirstProviders.length
          ? true
          : fallbackProviders.length > 0 &&
            allResults.some((result) =>
              fallbackProviders.some(
                (provider) => provider.name === result.provider
              )
            ),
    },

    results: finalResults,
    errors: allErrors,
  };
}

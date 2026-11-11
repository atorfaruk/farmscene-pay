
import {
  searchReevolSuppliers,
  deduplicateSuppliers,
} from "./server/suppliers/reevolSupplierSearch.js";

import {
  filterAgriculturalSuppliers,
} from "./server/suppliers/agriculturalRelevance.js";

import {
  assessSupplierList,
} from "./server/suppliers/supplierQuality.js";

const categories = [
  "crop seeds and planting materials suppliers",
  "agricultural fertilizers and soil nutrients suppliers",
  "agricultural pesticides, insecticides, herbicides and fungicides suppliers",
  "agricultural machinery, tractors, harvesters and farm equipment manufacturers",
  "agricultural hand tools and farm implements suppliers",
  "agricultural irrigation systems, drip irrigation, sprinkler systems, pumps and pipes suppliers",
];

const allResults = [];

let totalDiscoveryResults = 0;

for (const category of categories) {
  console.log(`\nSearching: ${category}`);

  try {
    const data = await searchReevolSuppliers(category, 8);

    const discovered = data.results || [];
    const classified = filterAgriculturalSuppliers(discovered);

    totalDiscoveryResults += discovered.length;
    allResults.push(...classified);

    console.log("Results:", discovered.length);
    console.log("Agricultural matches:", classified.length);
  } catch (error) {
    console.error(`Search failed for ${category}:`, error.message);
  }
}

const uniqueSuppliers = deduplicateSuppliers(allResults);

const qualityResults = assessSupplierList(uniqueSuppliers);

console.log("\n========== QUALITY CONTROL SUMMARY ==========");

console.log("TOTAL DISCOVERY RESULTS:", totalDiscoveryResults);
console.log("AGRICULTURAL MATCHES:", allResults.length);
console.log("UNIQUE SUPPLIERS:", uniqueSuppliers.length);
console.log("DUPLICATES MERGED:", allResults.length - uniqueSuppliers.length);

console.log(
  "COMPANY IDENTITY NEEDS REVIEW:",
  qualityResults.filter(
    (item) =>
      item.qualityAssessment.identity.status !== "possible_company"
  ).length
);

console.log(
  "POSSIBLE PRODUCT NAMES:",
  qualityResults.filter(
    (item) =>
      item.qualityAssessment.identity.status === "possible_product_name"
  ).length
);

console.log(
  "HS CODE EVIDENCE ONLY:",
  qualityResults.filter(
    (item) =>
      item.qualityAssessment.agriculturalRelevance.status === "trade_code_only"
  ).length
);

console.log(
  "WEBSITE MISSING:",
  qualityResults.filter(
    (item) =>
      item.qualityAssessment.website.status === "website_missing"
  ).length
);

console.log(
  "SOURCE MISSING:",
  qualityResults.filter(
    (item) =>
      item.qualityAssessment.source.status === "source_missing"
  ).length
);

console.log("\n========== SUPPLIER QUALITY REPORT ==========");

console.log(
  JSON.stringify(
    qualityResults.map((supplier) => ({
      name: supplier.name,
      country: supplier.country,
      website: supplier.website,

      categories: (supplier.agriculturalCategories || []).map(
        (item) => ({
          category: item.category,
          evidenceLevel: item.evidenceLevel,
          categoryStatus: item.categoryStatus,
          hsCodeEvidence: item.hsCodeEvidence,
          reviewReason: item.reviewReason,
          hsCodeLimitations: item.hsCodeLimitations,
        })
      ),

      identity: supplier.qualityAssessment.identity.status,

      agriculturalRelevance:
        supplier.qualityAssessment.agriculturalRelevance.status,

      qualityFlags: supplier.qualityAssessment.qualityFlags,

      verificationStatus:
        supplier.qualityAssessment.verificationStatus,

      overallStatus:
        supplier.qualityAssessment.overallStatus,
    })),
    null,
    2
  )
);
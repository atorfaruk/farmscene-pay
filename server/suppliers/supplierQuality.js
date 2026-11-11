
const PRODUCT_NAME_PATTERNS = [
  /\baluminium phosphide\b/i,
  /\bemamectin benzoate\b/i,
  /\b[a-z]+ phosphide\b/i,
  /\b[a-z]+ benzoate\b/i,
  /\b[a-z]+ glyphosate\b/i,
  /\b[a-z]+ sulfate\b/i,
  /\b[a-z]+ sulphate\b/i,
];

const LEGAL_ENTITY_PATTERNS = [
  /\blimited\b/i,
  /\bltd\b/i,
  /\bincorporated\b/i,
  /\binc\b/i,
  /\bcorporation\b/i,
  /\bcorp\b/i,
  /\bcompany\b/i,
  /\bllc\b/i,
  /\bpvt\b/i,
  /\bplc\b/i,
  /\bgmbh\b/i,
];

const BUSINESS_NAME_CLUES = [
  /\bsupply\b/i,
  /\bsupplies\b/i,
  /\btrading\b/i,
  /\bdistributing\b/i,
  /\bdistributors\b/i,
  /\bmanufacturing\b/i,
  /\bmanufacturers\b/i,
  /\bindustries\b/i,
  /\bmachinery\b/i,
  /\bhardware\b/i,
  /\bseeds\b/i,
  /\birrigation\b/i,
];

function hasProductLikeName(name = "") {
  return PRODUCT_NAME_PATTERNS.some((pattern) =>
    pattern.test(name)
  );
}

function hasLegalEntityName(name = "") {
  return LEGAL_ENTITY_PATTERNS.some((pattern) =>
    pattern.test(name)
  );
}

function hasBusinessNameClue(name = "") {
  return BUSINESS_NAME_CLUES.some((pattern) =>
    pattern.test(name)
  );
}

function assessIdentity(supplier) {
  const name = supplier.name || "";

  if (hasProductLikeName(name)) {
    return {
      status: "possible_product_name",
      reason: "The name resembles an agricultural chemical or product name.",
    };
  }

  if (hasLegalEntityName(name)) {
    return {
      status: "possible_company",
      reason: "The name contains a company-style legal suffix. Independent identity confirmation is still required.",
    };
  }

  if (hasBusinessNameClue(name)) {
    return {
      status: "possible_company",
      reason: "The name contains a business-related clue, but company identity is not independently established.",
    };
  }

  return {
    status: "needs_review",
    reason: "The available information does not establish whether this is a company or product name.",
  };
}

function assessAgriculturalRelevance(supplier) {
  const categories = supplier.agriculturalCategories || [];

  const directProductEvidence = categories.some(
    (category) =>
      (category.keywordEvidence || []).length > 0
  );

  const hsCodeEvidence = categories.some(
    (category) =>
      (category.hsCodeEvidence || []).length > 0
  );

  if (directProductEvidence) {
    return {
      status: "product_evidence_found",
      reason: "A dedicated product field matched an agricultural category. The product claim still requires confirmation.",
    };
  }

  if (hsCodeEvidence) {
    return {
      status: "trade_code_only",
      reason: "Agricultural relevance is indicated by HS codes only.",
    };
  }

  return {
    status: "no_agricultural_evidence",
    reason: "No relevant product-field or HS-code evidence was found.",
  };
}

function assessCategoryAccuracy(supplier) {
  const categories = supplier.agriculturalCategories || [];

  if (categories.length === 0) {
    return {
      status: "no_category",
      reason: "No agricultural category was assigned.",
    };
  }

  const directEvidenceCategories = categories.filter(
    (category) =>
      (category.keywordEvidence || []).length > 0
  );

  if (directEvidenceCategories.length > 0) {
    return {
      status: "needs_review",
      reason: "Product-field evidence exists, but the assigned categories still require confirmation.",
    };
  }

  return {
    status: "needs_review",
    reason: "Category assignments rely on HS-code clues, not confirmed products.",
  };
}

function assessWebsite(supplier) {
  if (supplier.website) {
    return {
      status: "website_available",
      value: supplier.website,
      reason: "A website was supplied in the Reevol profile. Ownership and operation have not been independently checked.",
    };
  }

  return {
    status: "website_missing",
    value: null,
    reason: "No website was supplied in the Reevol profile.",
  };
}

function assessSource(supplier) {
  if (supplier.source) {
    return {
      status: "source_available",
      value: supplier.source,
    };
  }

  return {
    status: "source_missing",
    value: null,
  };
}

export function assessSupplierQuality(supplier) {
  const identity = assessIdentity(supplier);
  const agriculturalRelevance = assessAgriculturalRelevance(supplier);
  const categoryAccuracy = assessCategoryAccuracy(supplier);
  const website = assessWebsite(supplier);
  const source = assessSource(supplier);

  const qualityFlags = [];

  if (
    identity.status !== "possible_company"
  ) {
    qualityFlags.push("COMPANY_IDENTITY_NEEDS_REVIEW");
  }

  if (identity.status === "possible_product_name") {
    qualityFlags.push("POSSIBLE_PRODUCT_NAME");
  }

  if (agriculturalRelevance.status === "trade_code_only") {
    qualityFlags.push("HS_CODE_EVIDENCE_ONLY");
  }

  if (agriculturalRelevance.status === "no_agricultural_evidence") {
    qualityFlags.push("NO_AGRICULTURAL_EVIDENCE");
  }

  if (website.status === "website_missing") {
    qualityFlags.push("WEBSITE_MISSING");
  }

  if (source.status === "source_missing") {
    qualityFlags.push("SOURCE_MISSING");
  }

  return {
    ...supplier,

    qualityAssessment: {
      identity,
      agriculturalRelevance,
      categoryAccuracy,
      website,
      source,
      qualityFlags,

      verificationStatus: "unverified",
      overallStatus: "review_required",
    },
  };
}

export function assessSupplierList(suppliers = []) {
  return suppliers.map(assessSupplierQuality);
}

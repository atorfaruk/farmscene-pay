
import express from "express";
import supabase from "./supabase.js";
import dotenv from "dotenv";
import { searchYouSuppliers } from "./youSearch.js";
import { searchSuppliers } from "./suppliers/supplierService.js";
import { analyzeFarmerRequest } from "./ai/gemini.js";
import { analyzeFarmerRequestWithGroq } from "./ai/groq.js";
import "dotenv/config";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({
    status: "online",
    project: "FarmScene Pay",
  });
});

app.post("/api/suppliers/search", async (req, res) => {
  try {
    const { product, location, country, region } = req.body;

    if (!product || typeof product !== "string") {
      return res.status(400).json({
        error: "Please provide a product to search for.",
      });
    }

    const destination = [location, country, region]
      .filter(Boolean)
      .join(", ");

    const query = `
      Find genuine manufacturers and suppliers of ${product}
      worldwide.
      Farmer delivery destination: ${destination || "Worldwide"}.
      Return company names, countries, official websites,
      product information and source URLs.
      Do not invent prices, stock, availability or delivery terms.
    `;

   const result = await searchSuppliers({
  product,
  location: location || country || region,
});

return res.json(result);

} catch (error) {
  console.error("Supplier search error:", error.message);
  return res.status(502).json({
    error: "Worldwide supplier search failed. Please try again.",
  });
}
});
app.post("/api/ai/procurement", async (req, res) => {
  try {
    const { request } = req.body;

    if (typeof request !== "string" || !request.trim()) {
      return res.status(400).json({
        error: "Please provide a farming procurement request.",
      });
    }

    let result;

    try {
      result = await analyzeFarmerRequest(request);
      console.log("AI provider used: Gemini");
    } catch (geminiError) {
      console.error("Gemini failed:", geminiError.message);

      try {
        result = await analyzeFarmerRequestWithGroq(request);
        console.log("AI provider used: Groq");
      } catch (groqError) {
        console.error("Groq failed:", groqError.message);

        result = await askOpenRouter(request);
        console.log("AI provider used: OpenRouter");
      }
    }

    return res.json(result);

  } catch (error) {
    console.error("All AI providers failed:", error.message);

    return res.status(502).json({
      error: "All AI providers failed. Please try again.",
    });
  }
});



app.post("/api/intents/quote", async (req, res) => {
  try {
    const { amount, recipient } = req.body;

    // Validate USDC amount (up to 6 decimal places).
    if (
      typeof amount !== "string" ||
      amount.length > 80 ||
      !/^\d+(?:\.\d{1,6})?$/.test(amount)
    ) {
      return res.status(400).json({
        error: "Enter a valid USDC amount with up to 6 decimal places.",
      });
    }

    // Accept NEAR Testnet accounts only.
    if (
      typeof recipient !== "string" ||
      !/^[a-z0-9._-]+\.testnet$/.test(recipient) ||
      recipient.length > 64
    ) {
      return res.status(400).json({
        error: "A valid NEAR Testnet recipient is required.",
      });
    }

    // Convert USDC to its smallest unit (6 decimals).
    const [whole, fraction = ""] = amount.split(".");

    const amountInBaseUnits = (
      BigInt(whole) * 1000000n +
      BigInt(fraction.padEnd(6, "0"))
    ).toString();

    if (BigInt(amountInBaseUnits) <= 0n) {
      return res.status(400).json({
        error: "Amount must be greater than zero.",
      });
    }

    const deadline = new Date(
      Date.now() + 10 * 60 * 1000
    ).toISOString();

    const quoteRequest = {
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,

      originAsset: "nep141:usdc.tidepool-sandbox.testnet",
      destinationAsset: "nep141:wnear.tidepool-sandbox.testnet",

      amount: amountInBaseUnits,

      depositType: "INTENTS",

      refundTo: recipient,
      refundType: "INTENTS",

      recipient,
      recipientType: "DESTINATION_CHAIN",

      deadline,
    };

    const response = await fetch(
      "https://www.usetidepool.tech/v0/quote",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(quoteRequest),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Tidepool quote error:", data);

      return res.status(response.status).json({
        error:
          data.message ||
          data.error ||
          "Tidepool quote request failed.",
        details: data,
      });
    }

    return res.json({
      success: true,
      provider: "Tidepool Community Sandbox",
      network: "NEAR Testnet",
      mode: "DRY_QUOTE",
      quoteRequest,
      quote: data,
    });

  } catch (error) {
    console.error("Tidepool quote error:", error);

    return res.status(500).json({
      error: "Unable to retrieve Tidepool quote.",
    });
  }
});

app.post("/api/payments/verify", async (req, res) => {
  try {
    const { transactionHash, senderId } = req.body;

    if (
      typeof transactionHash !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(transactionHash) ||
      typeof senderId !== "string" ||
      !/^[a-z0-9._-]+\.testnet$/.test(senderId)
    ) {
      return res.status(400).json({
        error: "Invalid transaction hash or testnet sender.",
      });
    }

    const rpcResponse = await fetch("https://rpc.testnet.near.org", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "farmscene-pay",
        method: "tx",
        params: [transactionHash, senderId],
      }),
    });

    const data = await rpcResponse.json();

    if (!rpcResponse.ok || data.error) {
      return res.status(502).json({
        error: "NEAR Testnet verification service failed.",
      });
    }

    const status = data.result?.status;

    if (status?.Failure) {
      return res.json({
        status: "failed",
        transactionHash,
      });
    }

    if (status?.SuccessValue !== undefined ||
        status?.SuccessReceiptId) {
      return res.json({
        status: "confirmed",
        transactionHash,
        blockHash: data.result.transaction_outcome?.block_hash,
      });
    }

    return res.json({
      status: "pending",
      transactionHash,
    });

  } catch (error) {
    console.error("NEAR verification error:", error.message);

    return res.status(502).json({
      error: "Unable to verify NEAR transaction.",
    });
  }
});

app.post("/api/payments/save", async (req, res) => {
  try {
    const {
      transactionHash,
      walletAddress,
      supplierName,
      recipientAddress,
      amount,
      status,
      blockHash,
    } = req.body;

    if (
      typeof transactionHash !== "string" ||
      typeof walletAddress !== "string" ||
      !/^[a-z0-9._-]+\.testnet$/.test(walletAddress) ||
      typeof supplierName !== "string" ||
      typeof recipientAddress !== "string" ||
      typeof amount !== "string" && typeof amount !== "number" ||
      !Number.isFinite(Number(amount)) ||
      Number(amount) <= 0 ||
      !["pending", "confirmed", "failed"].includes(status)
    ) {
      return res.status(400).json({
        error: "Invalid transaction details.",
      });
    }

    const { data, error } = await supabase
      .from("payment_transactions")
      .upsert(
        {
          transaction_hash: transactionHash,
          wallet_address: walletAddress,
          supplier_name: supplierName,
          recipient_address: recipientAddress,
        amount_near: String(amount),
status,
block_hash: blockHash || null,
        },
        { onConflict: "transaction_hash" }
      )
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      transaction: data,
    });
  } catch (error) {
    console.error("Transaction save error:", error.message);

    return res.status(500).json({
      error: "Could not save transaction history.",
    });
  }
});

app.get("/api/payments/history/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    if (!/^[a-z0-9._-]+\.testnet$/.test(walletAddress)) {
      return res.status(400).json({
        error: "Invalid NEAR testnet wallet address.",
      });
    }

    const { data, error } = await supabase
      .from("payment_transactions")
      .select("*")
      .eq("wallet_address", walletAddress)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.json({
      success: true,
      transactions: data,
    });
  } catch (error) {
    console.error("Transaction history error:", error.message);

    return res.status(500).json({
      error: "Could not retrieve transaction history.",
    });
  }
});
app.listen(PORT, () => {
  console.log(`FarmScene Pay backend running at http://localhost:${PORT}`);
});

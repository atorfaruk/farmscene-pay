
import express from "express";
import supabase from "./supabase.js";
import dotenv from "dotenv";
import "dotenv/config";

import {
  searchSuppliers,
  getSavedSuppliers,
} from "./suppliers/supplierService.js";

import { analyzeFarmerRequest } from "./ai/gemini.js";
import { analyzeFarmerRequestWithGroq } from "./ai/groq.js";
import { askOpenRouter } from "./ai/openrouter.js";
import {
  submitNearTransfer,
  getOutlayerRequest,
  getOutlayerApproval,
  getOutlayerNearAddress,
  getOutlayerNearBalance,
  getOutlayerBinding,
} from "./outlayer.js";
import { understandSupplierRequestWithGroq } from "./ai/groq.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: "1mb" }));

app.get("/api/outlayer/address", async (req, res) => {
  try {
    const result = await getOutlayerNearAddress();

    if (!result.ok) {
      return res.status(result.httpStatus).json({
        success: false,
        error: result.data,
      });
    }

    return res.json({
      success: true,
      wallet: result.data,
    });
  } catch (error) {
    console.error("OutLayer address error:", error.message);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


app.get("/api/outlayer/balance", async (req, res) => {
  try {
    const result = await getOutlayerNearBalance();

    return res.status(result.httpStatus).json({
      success: result.ok,
      balance: result.data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
app.get("/api/outlayer/binding", async (req, res) => {
  try {
    const result = await getOutlayerBinding();

    return res.status(result.httpStatus).json({
      success: result.ok,
      binding: result.data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "online",
    project: "FarmScene Pay",
  });
});


app.post("/api/outlayer/transfers", async (req, res) => {
  try {
    const { recipient, amount, confirmSubmission } = req.body;

    if (confirmSubmission !== true) {
      return res.status(400).json({
        error: "Explicit payment submission confirmation is required.",
      });
    }
if (
  typeof recipient !== "string" ||
  recipient.length > 64 ||
  !(
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(recipient) ||
    /^[0-9a-f]{64}$/i.test(recipient)
  )
) {
  return res.status(400).json({
    error: "Invalid NEAR recipient address.",
  });
}

// Confirm that the recipient exists on NEAR Testnet.
const accountCheck = await fetch("https://rpc.testnet.near.org", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "farmscene-recipient-check",
    method: "query",
    params: {
      request_type: "view_account",
      finality: "final",
      account_id: recipient,
    },
  }),
});

const accountData = await accountCheck.json();

if (!accountCheck.ok || accountData.error || !accountData.result) {
  return res.status(400).json({
    error: "Recipient account does not exist on NEAR Testnet.",
  });
}
    if (
      typeof amount !== "string" ||
      !/^[1-9]\d*$/.test(amount) ||
      BigInt(amount) > 10n ** 24n
    ) {
      return res.status(400).json({
        error: "Amount must be positive yoctoNEAR and cannot exceed 1 NEAR.",
      });
    }

    const result = await submitNearTransfer({
      to: recipient,
      amount,
    });

    if (!result.ok) {
      return res.status(502).json({
        error: "OutLayer rejected the transfer request.",
        outlayerHttpStatus: result.httpStatus,
        details: result.data,
      });
    }
console.log(
  "OutLayer response:",
  JSON.stringify(result.data, null, 2)
);
    return res.status(200).json({
      message: "OutLayer received the transfer request.",
      outlayer: result.data,
    });
  } catch (error) {
    console.error("OutLayer transfer error:", error.message);

    return res.status(500).json({
      error: "Unable to submit the OutLayer transfer request.",
    });
  }
});


app.get("/api/outlayer/requests/:requestId", async (req, res) => {
  try {
    const result = await getOutlayerRequest(req.params.requestId);

    if (!result.ok) {
      return res.status(result.httpStatus).json({
        error: "Unable to retrieve OutLayer request.",
        details: result.data,
      });
    }

    console.log(
  "OutLayer request status:",
  JSON.stringify(result.data, null, 2)
);

return res.json(result.data);
  } catch (error) {
    return res.status(400).json({
      error: error.message,
    });
  }
});


app.get("/api/outlayer/approvals/:approvalId", async (req, res) => {
  try {
    const result = await getOutlayerApproval(req.params.approvalId);

    if (!result.ok) {
      return res.status(result.httpStatus).json({
        error: "Unable to retrieve OutLayer approval.",
        details: result.data,
      });
    }

    return res.json(result.data);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post("/api/suppliers/search", async (req, res) => {
  try {
    const { request } = req.body;

    if (typeof request !== "string" || !request.trim()) {
      return res.status(400).json({
        error: "Please describe the supplier you need.",
      });
    }

    // Step 1: Gemini understands the request.
const understood = await understandSupplierRequestWithGroq(request);
    const criteria = understood.criteria;

    console.log("Gemini supplier criteria:", criteria);

    // Step 2: Search using the existing supplier engine.
    const result = await searchSuppliers({
      product: [
        criteria.product,
        criteria.specifications,
      ].filter(Boolean).join(" "),
      location: criteria.preferredSupplierLocation ||
        criteria.destination || "Worldwide",
    });

    // Step 3: Return search results and understood requirements.
    return res.json({
      success: true,
      provider: "Gemini + Existing Supplier Search",
      criteria,
      ...result,
    });

  } catch (error) {
    console.error("Supplier search error:", error.message);

    return res.status(502).json({
      error: error.message || "Supplier search failed. Please try again.",
    });
  }
});


app.post("/api/ai/procurement", async (req, res) => {
  try {
    const { request, farmerWallet } = req.body;

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

    // Save the procurement request and AI analysis.
    const { data: procurement, error: saveError } = await supabase
      .from("procurement_requests")
      .insert({
        farmer_wallet:
          typeof farmerWallet === "string" && farmerWallet.trim()
            ? farmerWallet.trim()
            : null,
        request_text: request.trim(),
        ai_analysis: result.analysis,
        status: "analysed",
      })
      .select("id, status, created_at")
      .single();

    if (saveError) {
      console.error("Procurement save error:", saveError.message);

      return res.status(500).json({
        error: "AI analysis completed, but the procurement request could not be saved.",
      });
    }

    return res.json({
      ...result,
      procurementId: procurement.id,
      procurementStatus: procurement.status,
      createdAt: procurement.created_at,
    });

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
    const transactionHash =
      req.body.transactionHash || req.body.txHash;

    const { senderId } = req.body;

    const validSender =
      typeof senderId === "string" &&
      (
        /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(senderId) ||
        /^[0-9a-f]{64}$/i.test(senderId)
      );

    if (
      typeof transactionHash !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(transactionHash) ||
      !validSender
    ) {
      return res.status(400).json({
        error: "Invalid transaction hash or NEAR Testnet sender.",
      });
    }

    const rpcResponse = await fetch(
      "https://rpc.testnet.near.org",
      {
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
      }
    );

    const data = await rpcResponse.json();

    if (!rpcResponse.ok || data.error || !data.result) {
      return res.status(502).json({
        error: "NEAR Testnet verification failed.",
        details: data.error || "Transaction not found.",
      });
    }

    const transaction = data.result.transaction;
    const status = data.result.status;

    if (!transaction || transaction.signer_id !== senderId) {
      return res.status(400).json({
        error: "Transaction sender does not match the supplied wallet.",
      });
    }

    if (status?.Failure) {
      return res.json({
        status: "failed",
        transactionHash,
      });
    }

    if (
      status?.SuccessValue !== undefined ||
      status?.SuccessReceiptId
    ) {
      return res.json({
        status: "confirmed",
        transactionHash,
        senderId: transaction.signer_id,
        receiverId: transaction.receiver_id,
        blockHash:
          data.result.transaction_outcome?.block_hash || null,
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
    } = req.body;

    // Validate payment details
    const validWallet =
      typeof walletAddress === "string" &&
      (
        /^[a-z0-9._-]+\.testnet$/.test(walletAddress) ||
        /^[0-9a-f]{64}$/i.test(walletAddress)
      );

    const validRecipient =
      typeof recipientAddress === "string" &&
      (
        /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(recipientAddress) ||
        /^[0-9a-f]{64}$/i.test(recipientAddress)
      );

    if (
      typeof transactionHash !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(transactionHash) ||
      !validWallet ||
      typeof supplierName !== "string" ||
      !validRecipient ||
      typeof amount !== "string" ||
      !/^(0|[1-9]\d*)(\.\d{1,24})?$/.test(amount) ||
      Number(amount) <= 0 ||
      status !== "confirmed"
    ) {
      return res.status(400).json({
        error: "Invalid or unconfirmed transaction details.",
      });
    }

    // Convert NEAR amount to yoctoNEAR
    const [whole, fraction = ""] = amount.split(".");

    const expectedYocto = (
      BigInt(whole) * 10n ** 24n +
      BigInt((fraction + "0".repeat(24)).slice(0, 24))
    ).toString();

    // Verify transaction directly on NEAR Testnet
    const rpcResponse = await fetch(
      "https://rpc.testnet.near.org",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "farmscene-payment-save",
          method: "tx",
          params: [transactionHash, walletAddress],
        }),
      }
    );

    const rpcData = await rpcResponse.json();
    const tx = rpcData.result?.transaction;
    const txStatus = rpcData.result?.status;

    if (
      !rpcResponse.ok ||
      rpcData.error ||
      !tx ||
      tx.signer_id !== walletAddress ||
      tx.receiver_id !== recipientAddress ||
      txStatus?.Failure ||
      !(
        txStatus?.SuccessValue !== undefined ||
        txStatus?.SuccessReceiptId
      )
    ) {
      return res.status(400).json({
        error: "NEAR transaction verification failed.",
      });
    }

    // Confirm that the transaction transferred the requested amount
    const transferAction = tx.actions?.find(
      (action) => action.Transfer
    );

    if (
      !transferAction ||
      transferAction.Transfer.deposit !== expectedYocto
    ) {
      return res.status(400).json({
        error: "Transaction recipient or amount does not match the payment request.",
      });
    }

    const blockHash =
      rpcData.result.transaction_outcome?.block_hash || null;

    // Save only the verified transaction
    const { data, error } = await supabase
      .from("payment_transactions")
      .upsert(
        {
          transaction_hash: transactionHash,
          wallet_address: walletAddress,
          supplier_name: supplierName,
          recipient_address: recipientAddress,
          amount_near: amount,
          status: "confirmed",
          block_hash: blockHash,
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
      error: "Could not verify or save transaction history.",
    });
  }
});


app.get("/api/payments/history/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const validWallet =
      /^[a-z0-9._-]+\.testnet$/.test(walletAddress) ||
      /^[0-9a-f]{64}$/i.test(walletAddress);

    if (!validWallet) {
      return res.status(400).json({
        error: "Invalid NEAR Testnet wallet address.",
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

import { useState, useRef, useEffect } from 'react'
import nearConnector from './nearWallet'
import './App.css'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function App() {
  const [activePage, setActivePage] = useState('dashboard')
  const [request, setRequest] = useState('')
  const [submitted, setSubmitted] = useState(false)
const [loading, setLoading] = useState(false)
const [error, setError] = useState('')
const [analysis, setAnalysis] = useState('')
  const [supplierProduct, setSupplierProduct] = useState('')
const [supplierLocation, setSupplierLocation] = useState('')
const [supplierRequest, setSupplierRequest] = useState('');
const [supplierLoading, setSupplierLoading] = useState(false)
const [supplierError, setSupplierError] = useState('')
const [supplierResults, setSupplierResults] = useState(null)
const [savedSuppliers, setSavedSuppliers] = useState([])
const [savedSuppliersLoading, setSavedSuppliersLoading] = useState(false)
const [savedSuppliersError, setSavedSuppliersError] = useState('')
const [savedSupplierSearch, setSavedSupplierSearch] = useState('')
const [savedSupplierCountry, setSavedSupplierCountry] = useState('')
const [savedSupplierType, setSavedSupplierType] = useState('')
const [savedSupplierPage, setSavedSupplierPage] = useState(1)
const [savedSupplierPagination, setSavedSupplierPagination] = useState(null)
const [walletConnecting, setWalletConnecting] = useState(false)
const walletListenerRegistered = useRef(false)
const [walletAccount, setWalletAccount] = useState('')
const [walletError, setWalletError] = useState('')
const [paymentSupplier, setPaymentSupplier] = useState('')
const [paymentRecipient, setPaymentRecipient] = useState('')
const [paymentAmount, setPaymentAmount] = useState('')
const [paymentPreview, setPaymentPreview] = useState(false)
const [paymentSending, setPaymentSending] = useState(false)
const [paymentMessage, setPaymentMessage] = useState('')
const [outlayerRequestId, setOutlayerRequestId] = useState('')
const OUTLAYER_NEAR_ADDRESS = "bb45dbb9173210d5bb3b6559324e6b252eb06eaa3341204e76e9946311f6f408";
const [outlayerTransactionHash, setOutlayerTransactionHash] = useState('')
const [outlayerPaymentStatus, setOutlayerPaymentStatus] = useState('')
const [paymentTransactions, setPaymentTransactions] = useState([])
const [outlayerApprovalId, setOutlayerApprovalId] = useState('');
const [outlayerApprovalStatus, setOutlayerApprovalStatus] = useState('');
const [tidepoolAmount, setTidepoolAmount] = useState('')
const [tidepoolQuote, setTidepoolQuote] = useState(null)
const [tidepoolLoading, setTidepoolLoading] = useState(false)
const [tidepoolError, setTidepoolError] = useState('')

useEffect(() => {
if (!walletAccount) {
  setPaymentTransactions([])
  return
}

  let isLoading = false

  async function loadPaymentHistory() {
    if (isLoading) return
    isLoading = true

    try {
      const response = await fetch(
        `/api/payments/history/${encodeURIComponent(OUTLAYER_NEAR_ADDRESS)}`
      )

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error('Could not load payment history.')
      }

      const transactions = data.transactions || []

      setPaymentTransactions(
        transactions.map((tx) => ({
          id: tx.id,
          supplier: tx.supplier_name,
          recipient: tx.recipient_address,
          amount: tx.amount_near,
          hash: tx.transaction_hash,
          date: tx.created_at,
          status: tx.status,
        }))
      )

      // Automatically verify pending transactions
      for (const tx of transactions) {
        if (tx.status !== 'pending') continue

        if (!/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(tx.transaction_hash)) {
          continue
        }

        try {
          const verifyResponse = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transactionHash: tx.transaction_hash,
              senderId: OUTLAYER_NEAR_ADDRESS,
            }),
          })

          const verification = await verifyResponse.json()

          if (
            !verifyResponse.ok ||
            !['confirmed', 'failed'].includes(verification.status)
          ) {
            continue
          }

          const saveResponse = await fetch('/api/payments/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transactionHash: tx.transaction_hash,
              walletAddress: OUTLAYER_NEAR_ADDRESS,
              supplierName: tx.supplier_name || 'Unknown supplier',
              recipientAddress: tx.recipient_address,
              amount: String(tx.amount_near),
              status: verification.status,
              blockHash: verification.blockHash || null,
            }),
          })

          if (!saveResponse.ok) {
            throw new Error('Could not update transaction status.')
          }

          setPaymentTransactions((previous) =>
            previous.map((item) =>
              item.hash === tx.transaction_hash
                ? { ...item, status: verification.status }
                : item
            )
          )
        } catch (verificationError) {
          console.error(
            'Transaction verification error:',
            verificationError.message
          )
        }
      }
    } catch (err) {
      console.error('Payment history error:', err.message)
    } finally {
      isLoading = false
    }
  }

  loadPaymentHistory()

  const interval = setInterval(loadPaymentHistory, 15000)

  return () => clearInterval(interval)
}, [walletAccount])


async function handleWalletConnect() {
  setWalletConnecting(true)
  setWalletError('')

  try {
    if (!walletListenerRegistered.current) {
      nearConnector.on('wallet:signIn', ({ accounts }) => {
        setWalletAccount(accounts?.[0]?.accountId || '')
      })

      nearConnector.on('wallet:signOut', () => {
        setWalletAccount('')
        setPaymentTransactions([])
      })

      walletListenerRegistered.current = true
    }

    await nearConnector.connect()
  } catch (err) {
    setWalletError(err.message || 'Wallet connection failed.')
  } finally {
    setWalletConnecting(false)
  }
}

function handlePaymentPreview(e) {
  e.preventDefault();

  if (
    !paymentSupplier.trim() ||
    !paymentRecipient.trim() ||
    !paymentAmount
  ) {
    setWalletError("Complete all payment details.");
    return;
  }

  if (
    !(
      /^[a-z0-9._-]+\.testnet$/.test(paymentRecipient.trim()) ||
      /^[0-9a-f]{64}$/i.test(paymentRecipient.trim())
    )
  ) {
    setWalletError(
      "Enter a valid NEAR Testnet or implicit account address."
    );
    return;
  }

  if (
    !Number.isFinite(Number(paymentAmount)) ||
    Number(paymentAmount) <= 0
  ) {
    setWalletError("Enter a valid payment amount.");
    return;
  }

  setWalletError("");
  setPaymentPreview(true);
}


async function handleTidepoolQuote(e) {
  e.preventDefault();

  if (!walletAccount) {
    setTidepoolError("Connect your NEAR Testnet wallet first.");
    return;
  }

  if (!tidepoolAmount || Number(tidepoolAmount) <= 0) {
    setTidepoolError("Enter a valid USDC amount.");
    return;
  }

  setTidepoolLoading(true);
  setTidepoolError("");
  setTidepoolQuote(null);

  try {
    const response = await fetch("/api/intents/quote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: tidepoolAmount,
        recipient: walletAccount,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to retrieve quote.");
    }

    setTidepoolQuote(data.quote);
  } catch (error) {
    setTidepoolError(
      error.message || "Tidepool quote request failed."
    );
  } finally {
    setTidepoolLoading(false);
  }
}

async function refreshOutlayerRequestStatus() {
  if (!outlayerRequestId) return;

  try {
    const response = await fetch(
      `/api/outlayer/requests/${outlayerRequestId}`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "Unable to refresh payment request."
      );
    }

    const status = data.status || "unknown";
    const txHash = data.tx_hash || "";

    setOutlayerPaymentStatus(status);

    if (txHash) {
      setOutlayerTransactionHash(txHash);
    }

    if (status !== "success" || !txHash) {
      setPaymentMessage(`OutLayer payment request: ${status}`);
      return;
    }

    const verificationResponse = await fetch(
      "/api/payments/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transactionHash: txHash,
          senderId: OUTLAYER_NEAR_ADDRESS,
        }),
      }
    );

    const verification = await verificationResponse.json();

    if (!verificationResponse.ok) {
      throw new Error(
        verification.error || "NEAR verification failed."
      );
    }

    if (verification.status === "confirmed") {
      const saveResponse = await fetch("/api/payments/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transactionHash: txHash,
          walletAddress: OUTLAYER_NEAR_ADDRESS,
          supplierName: paymentSupplier,
          recipientAddress: paymentRecipient.trim(),
          amount: paymentAmount.trim(),
          status: "confirmed",
          blockHash: verification.blockHash || null,
        }),
      });

      const saved = await saveResponse.json();

      if (!saveResponse.ok) {
        throw new Error(
          saved.error || "Could not save verified payment."
        );
      }

      setPaymentMessage(
        "Payment verified on NEAR Testnet and saved to Supabase."
      );
    } else {
      setPaymentMessage(
        `Transaction verification status: ${verification.status}`
      );
    }

  } catch (error) {
    setWalletError(error.message);
  }
}

async function refreshOutlayerStatus() {
  if (!outlayerApprovalId) {
    setWalletError("No OutLayer approval ID available.");
    return;
  }

  try {
    const response = await fetch(
      `/api/outlayer/approvals/${outlayerApprovalId}`
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error || "Unable to retrieve approval status."
      );
    }

    const approval = result.approval || result;

    setOutlayerApprovalStatus(
      approval.status || "Status unavailable"
    );

    setWalletError("");
  } catch (error) {
    setWalletError(error.message);
  }
}
async function handleApprovePayment() {
  if (paymentSending) return;

  setPaymentSending(true);
  setPaymentMessage("");
  setWalletError("");

  try {
    const amount = paymentAmount.trim();

    if (
      !/^(0|[1-9]\d*)(\.\d{1,24})?$/.test(amount) ||
      Number(amount) <= 0
    ) {
      throw new Error("Enter a valid NEAR amount.");
    }

    const [whole, fraction = ""] = amount.split(".");

    const yoctoAmount = (
      BigInt(whole) * 10n ** 24n +
      BigInt((fraction + "0".repeat(24)).slice(0, 24))
    ).toString();

    if (BigInt(yoctoAmount) > 10n ** 24n) {
      throw new Error(
        "Maximum payment is 1 NEAR under your OutLayer policy."
      );
    }

    const response = await fetch("/api/outlayer/transfers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: paymentRecipient.trim(),
        amount: yoctoAmount,
        confirmSubmission: true,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error || "OutLayer rejected the request."
      );
    }

    const outlayer = result.outlayer || {};

    const requestId = outlayer.request_id || "";
    const approvalId = outlayer.approval_id || "";
    const status = outlayer.status || "submitted";

    if (!requestId) {
      throw new Error(
        "OutLayer response did not contain a request ID."
      );
    }

    setOutlayerRequestId(requestId);
    setOutlayerApprovalId(approvalId);
    setOutlayerPaymentStatus(status);
    setOutlayerApprovalStatus(
      approvalId ? "pending" : "not_required"
    );

    if (status === "pending_approval") {
      setPaymentMessage(
        "Payment request submitted. Awaiting approval in OutLayer."
      );
    } else {
      setPaymentMessage(
        "Payment request received. Check its status before considering it paid."
      );
    }

  } catch (err) {
    setWalletError(
      err.message || "OutLayer payment request failed."
    );
  } finally {
    setPaymentSending(false);
  }
}

async function handleSubmit(e) {
  e.preventDefault();

  if (!request.trim() || loading) return;

  setLoading(true);
  setError('');
  setAnalysis('');
  setSubmitted(false);

  try {
    const response = await fetch('/api/ai/procurement', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ request }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'AI analysis failed.');
    }

    setAnalysis(data.analysis);
    setSubmitted(true);

  } catch (err) {
    setError(err.message || 'Unable to connect to the AI service.');
  } finally {
    setLoading(false);
  }
}


async function handleSupplierSearch(e) {
  e.preventDefault();

  if (!supplierRequest.trim() || supplierLoading) {
    return;
  }

  setSupplierLoading(true);
  setSupplierError('');
  setSupplierResults(null);

  try {
    const response = await fetch('/api/suppliers/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request: supplierRequest.trim(),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Supplier search failed.');
    }

    setSupplierResults(data);

    console.log('Gemini supplier criteria:', data.criteria);
    console.log('Supplier search results:', data.suppliers);

  } catch (err) {
    setSupplierError(err.message || 'Unable to search suppliers.');
  } finally {
    setSupplierLoading(false);
  }
}

async function loadSavedSuppliers(page = 1) {
  setSavedSuppliersLoading(true)
  setSavedSuppliersError('')

  try {
    const params = new URLSearchParams({
      search: savedSupplierSearch,
      country: savedSupplierCountry,
      supplierType: savedSupplierType,
      page: String(page),
      limit: '20',
    })

    const response = await fetch(`/api/suppliers?${params}`)
    const data = await response.json()

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Unable to load saved suppliers.')
    }

    setSavedSuppliers(data.suppliers || [])
    setSavedSupplierPagination(data.pagination)
    setSavedSupplierPage(page)
  } catch (error) {
    setSavedSuppliersError(error.message)
  } finally {
    setSavedSuppliersLoading(false)
  }
}

useEffect(() => {
  if (activePage === 'suppliers') {
    loadSavedSuppliers(1);
  }
}, [activePage]);
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">🌾</div>
          <div>
            <h2>FarmScene <span>Pay</span></h2>
            <small>INTELLIGENT AGRICULTURE</small>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>
       <nav>
  <button
    className={`nav-item ${activePage === 'dashboard' ? 'active' : ''}`}
    onClick={() => setActivePage('dashboard')}
  >
    ▦ Dashboard
  </button>
<button
  className={`nav-item ${activePage === 'procurement' ? 'active' : ''}`}
  onClick={() => setActivePage('procurement')}
>
  ◈ New Procurement
</button>

  <button
    className={`nav-item ${activePage === 'payments' ? 'active' : ''}`}
    onClick={() => setActivePage('payments')}
  >
    ⇄ Payments
  </button>

  <button
    className={`nav-item ${activePage === 'security' ? 'active' : ''}`}
    onClick={() => setActivePage('security')}
  >
    ⬡ Security & Trust
  </button>
</nav>

        <div className="sidebar-bottom">
          <div className="network-status">
            <span className="status-dot"></span>
            NEAR TESTNET
            <small>Development mode</small>
          </div>
          <p>FarmScene Pay v0.1.0</p>
        </div>
      </aside>

      <main className="main-content" id="dashboard">
        <header className="topbar">
          <div>
            <p className="eyebrow">AGRICULTURAL FINANCE INTELLIGENCE</p>
           <h1>
  {activePage === 'dashboard' && 'Dashboard'}
  {activePage === 'procurement' && 'AI Procurement'}
  {activePage === 'suppliers' && 'Supplier Network'}
  {activePage === 'payments' && 'Payments'}
  {activePage === 'security' && 'Security & Trust'}
</h1>
          </div>
          <div className="topbar-right">
            <span className="environment">TEST ENVIRONMENT</span>
            <div className="avatar">FP</div>
          </div>
        </header>
{activePage === 'dashboard' && (
  <>
    
<section className="welcome">
  <div>
    <p className="eyebrow">YOUR AGRICULTURAL BUSINESS ASSISTANT</p>

    <h2>
      Smarter farming starts with <span>intelligent decisions.</span>
    </h2>

    <p>
      Manage agricultural procurement, analyse purchase requests and control payments securely with AI.
    </p>

    <button
      className="primary-button"
      onClick={() => setActivePage('procurement')}
    >
      Create Procurement Request →
    </button>
  </div>

  <div className="welcome-icon">🌾</div>
</section>

  </>
)}
      {activePage === 'dashboard' && (
  <section className="stats">
    <div className="stat-card">
      <span>AI AGENT</span>
<h3>AI Enabled</h3>
<small>Gemini primary · Groq fallback</small>
    </div>

    <div className="stat-card">
   <span>SPEND CONTROL</span>
<h3>Policy Protected</h3>
<small>OutLayer spending limits and human approval</small>
    </div>

    <div className="stat-card">
      <span>NEAR WALLET</span>

      <h3>{walletAccount || 'Not connected'}</h3>

      <small>
        {walletAccount
          ? 'NEAR Testnet connected'
          : 'Connect your testnet wallet'}
      </small>

      {!walletAccount && (
        <button
          className="primary-button"
          onClick={handleWalletConnect}
          disabled={walletConnecting}
        >
          {walletConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      )}

      {walletError && <small>{walletError}</small>}
    </div>
<div className="stat-card">
  <span>OUTLAYER CUSTODY</span>
  <h3>Configured</h3>
  <small>NEAR Testnet · Policy controlled</small>
</div>
  </section>
)}
{activePage === 'dashboard' && (
  <section className="panel recent-activity">
    <div className="panel-heading">
      <h3>Recent Activity</h3>
      <span className="coming-soon">Latest Transactions</span>
    </div>

    {paymentTransactions.length === 0 ? (
      <div className="empty-state compact">
        <h4>No recent activity</h4>
        <p>
          Your confirmed and pending payment records will appear here.
        </p>
      </div>
    ) : (
      <div className="transaction-list">
        {paymentTransactions.slice(0, 5).map((tx) => (
          <div className="transaction-item" key={tx.id}>
            <h4>{tx.supplier}</h4>
            <p>Amount: {tx.amount} NEAR</p>
            <p>Status: {tx.status}</p>
            <p>Transaction: {tx.hash.slice(0, 12)}...</p>
            <p>{tx.date}</p>
          </div>
        ))}
      </div>
    )}
  </section>
)}

        <section className="workspace-grid">
         {activePage === 'procurement' && (
  <div className="panel procurement" id="procurement">
    <div className="panel-heading">
      <div>
        <span className="panel-icon">✦</span>
        <h3>AI Procurement Assistant</h3>
      </div>
      <span className="coming-soon">AI Powered</span>
    </div>

    <p className="panel-description">
      Describe what you need for your farm. Our AI procurement engine will analyse your requirements.
    </p>

    <form onSubmit={handleSubmit}>
      <label htmlFor="farm-request">
        WHAT DO YOU NEED FOR YOUR FARM?
      </label>

      <textarea
        id="farm-request"
        value={request}
        onChange={(e) => {
          setRequest(e.target.value);
          setSubmitted(false);
        }}
        placeholder="Example: I need fertilizer and maize seeds for my 2-hectare farm. My budget is $300..."
        rows="5"
      />

      <button type="submit" className="primary-button" disabled={loading}>
        {loading ? 'Analysing...' : 'Prepare procurement request →'}
      </button>
    </form>

    {loading && (
      <div className="request-feedback">
        <strong>Analysing your farming request...</strong>
        <p>Please wait while the AI processes your requirements.</p>
      </div>
    )}

    {error && (
      <div className="request-feedback">
        <strong>Analysis failed</strong>
        <p>{error}</p>
      </div>
    )}

    {submitted && analysis && (
      <div className="request-feedback">
        <strong>AI Procurement Analysis</strong>
        <div className="analysis-result">
  <ReactMarkdown remarkPlugins={[remarkGfm]}>
    {analysis}
  </ReactMarkdown>
</div>
      </div>
    )}
  </div>
)}

{activePage === 'suppliers' && (
  <div className="panel" id="suppliers">
    <div className="panel-heading">
      <div>
        <span className="panel-icon">♧</span>
        <h3>Supplier Intelligence</h3>
      </div>
    </div>

   
<form onSubmit={handleSupplierSearch}>
  <label htmlFor="supplier-request">
    DESCRIBE THE SUPPLIER YOU NEED
  </label>

  <textarea
    id="supplier-request"
    value={supplierRequest}
    onChange={(e) => setSupplierRequest(e.target.value)}
    placeholder="Example: I need 2 tonnes of NPK 15-15-15 fertilizer. Find manufacturers and distributors worldwide, prioritising suppliers who can deliver to Michigan, USA. Include company names, contact emails and official websites."
    rows={5}
    required
  />

  <button
    type="submit"
    className="primary-button"
    disabled={supplierLoading || !supplierRequest.trim()}
  >
    {supplierLoading
      ? 'Understanding request and searching...'
      : 'Find Global Suppliers →'}
  </button>
</form>

    {supplierError && (
      <div className="request-feedback">
        <strong>Search failed</strong>
        <p>{supplierError}</p>
      </div>
    )}

    {supplierResults && (
      <div className="request-feedback">
        <strong>
          {supplierResults.suppliers?.length
            ? `${supplierResults.suppliers.length} Supplier & Marketplace Leads Found`
            : 'No Supplier Search Results Found'}
        </strong>

        <p>{supplierResults.message}</p>

        {supplierResults.criteria && (
          <div>
            <h4>Gemini understood your request</h4>
            <p><strong>Product:</strong> {supplierResults.criteria.product}</p>
            <p><strong>Quantity:</strong> {supplierResults.criteria.quantity || 'Not specified'} {supplierResults.criteria.unit}</p>
            <p><strong>Destination:</strong> {supplierResults.criteria.destination || 'Not specified'}</p>
            <p><strong>Supplier location:</strong> {supplierResults.criteria.preferredSupplierLocation || 'Worldwide'}</p>
          </div>
        )}

        {supplierResults.suppliers?.map((supplier, index) => {
          const email = supplier.contactEmail || supplier.email;
          const phone = supplier.contactPhone || supplier.phone;
          const location = supplier.location || supplier.address || supplier.country;
          const website = supplier.officialWebsite || supplier.website;
          const source = supplier.source || supplier.url;

          return (
            <div
              key={supplier.url || supplier.website || index}
              className="supplier-result"
            >
              <h4>{supplier.name || supplier.companyName || 'Unnamed supplier'}</h4>

              <p className="supplier-category">
                {supplier.supplierType || supplier.category || 'Type not established'}
              </p>

              <p>{supplier.description || supplier.evidenceSummary || 'No description available.'}</p>

              <p><strong>Location:</strong> {location || 'Not publicly available'}</p>

              <p>
                <strong>Email:</strong>{' '}
                {email ? <a href={`mailto:${email}`}>{email}</a> : 'Not publicly available'}
              </p>

              {phone && <p><strong>Phone:</strong> {phone}</p>}

              {website && (
                <p>
                  <strong>Official website:</strong>{' '}
                  <a href={website} target="_blank" rel="noreferrer">
                    Visit website
                  </a>
                </p>
              )}

              {source && (
                <p>
                  <a href={source} target="_blank" rel="noreferrer">
                    View source evidence →
                  </a>
                </p>
              )}

              <p>
                <strong>Verification:</strong>{' '}
                {supplier.verificationStatus || 'Unverified'}
              </p>
            </div>
          );
        })}
      </div>
    )}

  </div>
)}

{activePage === 'payments' && (
  <section className="payments-grid">

    {/* PREPARE SUPPLIER PAYMENT */}
    <div className="panel" id="prepare-payment">
      <div className="panel-heading">
        <h3>Prepare Supplier Payment</h3>
        <span className="coming-soon">Testnet Only</span>
      </div>

      <p className="panel-description">
        Review supplier payment details before requesting approval.
      </p>

      <div className="payment-wallet-status">
        <strong>OutLayer Custody</strong>
        <p>Configured · NEAR Testnet</p>
        <small>
          Payments are submitted through policy-controlled custody.
        </small>
      </div>

      <form onSubmit={handlePaymentPreview}>
        <label>SUPPLIER NAME</label>
        <input
          value={paymentSupplier}
          onChange={(e) => setPaymentSupplier(e.target.value)}
          placeholder="Supplier name"
          required
        />

        <label>SUPPLIER NEAR ACCOUNT</label>
        <input
          value={paymentRecipient}
          onChange={(e) => setPaymentRecipient(e.target.value)}
          placeholder="supplier.testnet"
          required
        />

        <label>PAYMENT AMOUNT (NEAR)</label>
        <input
          type="number"
          min="0.01"
          max="1"
          step="0.01"
          value={paymentAmount}
          onChange={(e) => setPaymentAmount(e.target.value)}
          placeholder="0.00"
          required
        />

        <small>Network: NEAR Testnet · Maximum per transaction: 1 NEAR</small>

        <button type="submit" className="primary-button">
          Generate Payment Preview
        </button>
      </form>

      {paymentPreview && (
        <div className="request-feedback">
          <h4>Payment Preview</h4>

          <p>
            Supplier: {paymentSupplier}
          </p>
          <p>
            Recipient: {paymentRecipient}
          </p>
          <p>
            Amount: {paymentAmount} NEAR
          </p>

          <button
            type="button"
            className="primary-button"
            onClick={handleApprovePayment}
            disabled={paymentSending}
          >
            {paymentSending
              ? 'Submitting Request...'
              : 'Request OutLayer Approval'}
          </button>
        </div>
      )}

      {walletError && (
        <div className="request-feedback">
          <p>{walletError}</p>
        </div>
      )}

      {paymentMessage && (
        <div className="request-feedback">
          <p>{paymentMessage}</p>
        </div>
      )}
    </div>


    {/* OUTLAYER APPROVAL & SECURITY */}
    <div className="panel" id="outlayer-security">
      <div className="panel-heading">
        <h3>OutLayer Approval & Security</h3>
        <span className="coming-soon">Policy Protected</span>
      </div>

      <p className="panel-description">
        Every procurement payment is subject to configured
        spending policies and human approval.
      </p>

      <div className="security-details">
        <p><strong>Network:</strong> NEAR Testnet</p>
        <p><strong>Maximum per transaction:</strong> 1 NEAR</p>
        <p><strong>Hourly spending limit:</strong> 2 NEAR</p>
        <p><strong>Daily spending limit:</strong> 5 NEAR</p>
        <p><strong>Monthly spending limit:</strong> 20 NEAR</p>
        <p><strong>Human approval:</strong> Required</p>
      </div>

      <div className="request-feedback">
        <h4>Approval Status</h4>

        <p>
          <strong>Approval:</strong>{' '}
          {outlayerApprovalStatus || 'Not checked'}
        </p>

        {outlayerApprovalId && (
          <p>
            <strong>Approval ID:</strong> {outlayerApprovalId}
          </p>
        )}

        <button
          type="button"
          onClick={refreshOutlayerStatus}
          disabled={!outlayerApprovalId}
        >
          Refresh Approval Status
        </button>

        <p>
          Review this request in OutLayer Custody → Approvals.
        </p>
      </div>

      <div className="request-feedback">
        <h4>Payment Request Status</h4>

        <p>
          {outlayerPaymentStatus || 'No payment request submitted yet.'}
        </p>

        {outlayerRequestId && (
          <>
            <p>
              <strong>Request ID:</strong> {outlayerRequestId}
            </p>

            <button
              type="button"
              onClick={refreshOutlayerRequestStatus}
            >
              Refresh Payment Status
            </button>
          </>
        )}

        {outlayerTransactionHash && (
          <p>
            <strong>Transaction Hash:</strong>{' '}
            {outlayerTransactionHash}
          </p>
        )}
      </div>
    </div>


    {/* PAYMENT ACTIVITY */}
    <div className="panel" id="payment-activity">
      <div className="panel-heading">
        <h3>Payment Activity</h3>
        <span className="coming-soon">Testnet</span>
      </div>

      {paymentTransactions.length === 0 ? (
        <div className="empty-state compact">
          <div>⇄</div>
          <h4>No transactions yet</h4>
          <p>
            Verified NEAR Testnet transactions will appear here.
          </p>
        </div>
      ) : (
        <div className="transaction-list">
          {paymentTransactions.map((tx) => (
            <div className="transaction-item" key={tx.id}>
              <h4>{tx.supplier}</h4>
              <p>Recipient: {tx.recipient}</p>
              <p>Amount: {tx.amount} NEAR</p>
              <p>Status: {tx.status}</p>
              <p>
                Transaction: {tx.hash
                  ? `${tx.hash.slice(0, 12)}...`
                  : 'Not available'}
              </p>
              <p>{tx.date}</p>

              {tx.hash && (
                <>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(tx.hash)}
                  >
                    Copy Hash
                  </button>

                  <a
                    href={`https://testnet.nearblocks.io/txns/${tx.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View on Explorer
                  </a>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>

  </section>
)}

{activePage === 'security' && (
  <div className="panel" id="security">
    <div className="panel-heading">
      <h3>Security & Trust</h3>
    </div>

    <div className="security-row">
      <span>OutLayer Custody</span>
<span className="safe">Configured — NEAR Testnet</span>
    </div>

    <div className="security-row">
     <span>Spending policies</span>
<span className="safe">Configured — Active</span>
    </div>

    <div className="security-row">
      <span>Human payment approval</span>
      <span className="safe">Required</span>
    </div>

    <div className="security-row">
      <span>Blockchain verification</span>
      <span className="safe">Active — NEAR Testnet</span>
    </div>
  </div>
)}
        </section>

        <footer>
          FarmScene Pay © 2026 · AI-powered agricultural procurement · Built on NEAR
        </footer>
      </main>
    </div>
  )
}

export default App

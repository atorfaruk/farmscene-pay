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
const [supplierLoading, setSupplierLoading] = useState(false)
const [supplierError, setSupplierError] = useState('')
const [supplierResults, setSupplierResults] = useState(null)
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
const [paymentTransactions, setPaymentTransactions] = useState([])
const [tidepoolAmount, setTidepoolAmount] = useState('')
const [tidepoolQuote, setTidepoolQuote] = useState(null)
const [tidepoolLoading, setTidepoolLoading] = useState(false)
const [tidepoolError, setTidepoolError] = useState('')
useEffect(() => {
  if (!walletAccount) return

  let isLoading = false

  async function loadPaymentHistory() {
    if (isLoading) return
    isLoading = true

    try {
      const response = await fetch(
        `/api/payments/history/${encodeURIComponent(walletAccount)}`
      )

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error('Could not load payment history.')
      }

      const transactions = data.transactions

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

        // Skip invalid demo/test hashes
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(tx.transaction_hash)) {
          continue
        }

        try {
          const verifyResponse = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transactionHash: tx.transaction_hash,
              senderId: walletAccount,
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
              walletAddress: walletAccount,
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
  e.preventDefault()

  if (!walletAccount) {
    setWalletError('Connect your NEAR testnet wallet first.')
    return
  }

  if (!paymentSupplier.trim() || !paymentRecipient.trim() || !paymentAmount) {
    return
  }

 if (!/^[a-z0-9._-]+\.testnet$/.test(paymentRecipient.trim())) {
    setWalletError('Enter a valid NEAR testnet account ID.')
    return
  }

  if (!Number.isFinite(Number(paymentAmount)) || Number(paymentAmount) <= 0) {
    setWalletError('Enter a valid payment amount.')
    return
  }

  setWalletError('')
  setPaymentPreview(true)
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

async function handleApprovePayment() {
  if (paymentSending) return

  setPaymentSending(true)
  setPaymentMessage('')
  setWalletError('')

  try {
    const amount = paymentAmount.trim()

    if (!/^(0|[1-9]\d*)(\.\d{1,24})?$/.test(amount) || Number(amount) <= 0) {
      throw new Error('Enter a valid NEAR amount.')
    }

    const [whole, fraction = ''] = amount.split('.')

    const yoctoAmount = (
      BigInt(whole) * 10n ** 24n +
      BigInt((fraction + '0'.repeat(24)).slice(0, 24))
    ).toString()

    const wallet = await nearConnector.wallet()

    const result = await wallet.signAndSendTransaction({
      receiverId: paymentRecipient.trim(),
      actions: [{
        type: 'Transfer',
        params: {
          deposit: yoctoAmount,
        },
      }],
    })

    const hash = result?.transaction?.hash ||
      result?.transaction_outcome?.id

    if (!hash) {
      setPaymentMessage(
        'Wallet returned without a transaction hash. Check your wallet before retrying.'
      )
      return
    }


    setPaymentTransactions((previous) => [
      {
        id: hash,
        supplier: paymentSupplier,
        recipient: paymentRecipient.trim(),
        amount: paymentAmount,
        hash,
        date: new Date().toLocaleString(),
        status: 'Submitted',
      },
      ...previous,
    ])

    let paymentStatus = 'pending'
    let verifiedBlockHash = null

    // Verify transaction on NEAR
    try {
      const verificationResponse = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transactionHash: hash,
          senderId: walletAccount,
        }),
      })

      const verification = await verificationResponse.json()

      if (!verificationResponse.ok) {
        throw new Error('Verification unavailable')
      }

      paymentStatus = verification.status
      verifiedBlockHash = verification.blockHash || null

      setPaymentTransactions((previous) =>
        previous.map((tx) =>
          tx.hash === hash
            ? { ...tx, status: paymentStatus }
            : tx
        )
      )
    } catch (verificationError) {
      console.error('Verification issue:', verificationError.message)
    }

    // Save transaction in Supabase
    try {
      const saveResponse = await fetch('/api/payments/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transactionHash: hash,
          walletAddress: walletAccount,
          supplierName: paymentSupplier,
          recipientAddress: paymentRecipient.trim(),
          amount: paymentAmount,
          status: paymentStatus,
          blockHash: verifiedBlockHash,
        }),
      })

      if (!saveResponse.ok) {
        throw new Error('Transaction could not be saved')
      }

      setPaymentMessage(
        paymentStatus === 'confirmed'
          ? 'Payment confirmed and saved successfully.'
          : 'Payment submitted and saved. Verification is pending.'
      )
    } catch (saveError) {
      console.error('Supabase save issue:', saveError.message)

      setPaymentMessage(
        'Payment submitted. Transaction history could not be saved yet. Keep your hash.'
      )
    }

  } catch (err) {
    setWalletError(err.message || 'Payment was cancelled or failed.')
  } finally {
    setPaymentSending(false)
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

  if (
    !supplierProduct.trim() ||
    !supplierLocation.trim() ||
    supplierLoading
  ) {
    return;
  }

  const products = [
    ...new Set(
      supplierProduct
        .split(/[,;\n]+|\s+(?:and|&)\s+/i)
        .map((product) => product.trim())
        .filter(Boolean)
    ),
  ];

  setSupplierLoading(true);
  setSupplierError('');
  setSupplierResults(null);

  try {
    const results = [];

    // Search each requested product sequentially.
    for (const product of products) {
      const response = await fetch('/api/suppliers/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          product,
          location: supplierLocation,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || `Search failed for ${product}.`
        );
      }

      results.push({
        product,
        ...data,
      });
    }

    // Combine all product search results.
    const allSuppliers = results.flatMap((result) =>
      (result.suppliers || []).map((supplier) => ({
        ...supplier,
        searchedProduct: result.product,
      }))
    );

    const allResearchSources = results.flatMap((result) =>
      (result.researchSources || []).map((source) => ({
        ...source,
        searchedProduct: result.product,
      }))
    );

    // Deduplicate companies across all product searches.
    const supplierMap = new Map();

    for (const supplier of allSuppliers) {
      const key = (
        supplier.website ||
        supplier.source ||
        `${supplier.name}-${supplier.searchedProduct}`
      ).toLowerCase();

      if (!supplierMap.has(key)) {
        supplierMap.set(key, supplier);
      }
    }

    const uniqueSuppliers = Array.from(
      supplierMap.values()
    );

    // Prioritise the five supplier categories.
    const priority = {
      manufacturer: 1,
      distributor: 2,
      wholesaler: 3,
      retailer: 4,
      marketplace: 5,
    };

    const rankedSuppliers = [...uniqueSuppliers].sort(
      (a, b) => {
        const aType = String(
          a.supplierType || a.category || 'unknown'
        ).toLowerCase();

        const bType = String(
          b.supplierType || b.category || 'unknown'
        ).toLowerCase();

        const aPriority =
          priority[aType] || 99;

        const bPriority =
          priority[bType] || 99;

        return aPriority - bPriority;
      }
    );

    // GLOBAL LIMIT: maximum 15 across every product.
    const finalSuppliers = rankedSuppliers.slice(0, 15);

    // Deduplicate research sources separately.
    const uniqueResearchSources = [
      ...new Map(
        allResearchSources.map((source) => [
          source.website ||
            source.source ||
            `${source.name}-${source.searchedProduct}`,
          source,
        ])
      ).values(),
    ];

    setSupplierResults({
      status: finalSuppliers.length
        ? 'leads_found'
        : 'no_results',

      message: finalSuppliers.length
        ? `${finalSuppliers.length} supplier and marketplace leads discovered across ${products.length} product searches. Maximum 15 results across all products. Verify each company and offer before procurement.`
        : `No supplier leads were returned across ${products.length} product searches. Try refining the product description or location.`,

      search: {
        products,
        location: supplierLocation,
        maximumResults: 15,
      },

      provider: 'Multi-provider fallback',

      suppliers: finalSuppliers,

      researchSources: uniqueResearchSources,

      totalLeadsBeforeLimit: uniqueSuppliers.length,

      totalLeadsReturned: finalSuppliers.length,
    });

  } catch (err) {
    setSupplierError(
      err.message || 'Unable to search suppliers.'
    );
  } finally {
    setSupplierLoading(false);
  }
}

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
    ◈ AI Procurement
  </button>

  <button
    className={`nav-item ${activePage === 'suppliers' ? 'active' : ''}`}
    onClick={() => setActivePage('suppliers')}
  >
    ♧ Suppliers
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
          Understand your farming needs, evaluate suppliers and prepare secure purchases with AI.
        </p>
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
      <span>SUPPLIER NETWORK</span>
<h3>Search Enabled</h3>
<small>Live supplier and marketplace leads</small>
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
      <span>OUTLAYER TEE</span>
      <h3>Not connected</h3>
      <small>Secure execution pending</small>
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

    <p className="panel-description">
      Discover agricultural supplier leads worldwide.
    </p>

    <form onSubmit={handleSupplierSearch}>
      <label htmlFor="supplier-product">PRODUCT REQUIRED</label>
      <input
        id="supplier-product"
        value={supplierProduct}
        onChange={(e) => setSupplierProduct(e.target.value)}
        placeholder="e.g. NPK fertilizer"
      />

      <label htmlFor="supplier-location">TARGET LOCATION</label>
      <input
        id="supplier-location"
        value={supplierLocation}
        onChange={(e) => setSupplierLocation(e.target.value)}
        placeholder="e.g. England; USA; or Worldwide"
      />

      <button
        type="submit"
        className="primary-button"
        disabled={supplierLoading}
      >
        {supplierLoading ? 'Searching...' : 'Find Suppliers →'}
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

        {supplierResults.suppliers?.map((supplier, index) => (
          <div key={supplier.url || index}>
            <h4>{supplier.name}</h4>
            <p className="supplier-category">{supplier.category}</p>
            <p>{supplier.description}</p>

            {(supplier.website || supplier.source) && (
              <a
                href={supplier.website || supplier.source}
                target="_blank"
                rel="noreferrer"
              >
                Visit supplier source →
              </a>
            )}
          </div>
        ))}
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
        <strong>NEAR Wallet</strong>

        {walletAccount ? (
          <p>Connected: {walletAccount}</p>
        ) : (
          <button
            type="button"
            className="primary-button"
            onClick={handleWalletConnect}
            disabled={walletConnecting}
          >
            {walletConnecting ? 'Connecting...' : 'Connect NEAR Wallet'}
          </button>
        )}
      </div>

      <form onSubmit={handlePaymentPreview}>
        <label>SUPPLIER NAME</label>
        <input
          value={paymentSupplier}
          onChange={(e) => setPaymentSupplier(e.target.value)}
          placeholder="Supplier name"
        />

        <label>SUPPLIER NEAR ACCOUNT</label>
        <input
          value={paymentRecipient}
          onChange={(e) => setPaymentRecipient(e.target.value)}
          placeholder="supplier.testnet"
        />

        <label>PAYMENT AMOUNT (NEAR)</label>
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={paymentAmount}
          onChange={(e) => setPaymentAmount(e.target.value)}
          placeholder="0.00"
        />

        <small>Network: NEAR Testnet</small>

        <button type="submit" className="primary-button">
          Generate Payment Preview
        </button>
      </form>

      {paymentPreview && (
        <div className="request-feedback">
          <h4>Payment Preview</h4>
          <p>Supplier: {paymentSupplier}</p>
          <p>Recipient: {paymentRecipient}</p>
          <p>Amount: {paymentAmount} NEAR</p>
          <p>Network: NEAR Testnet</p>
          <strong>Awaiting farmer approval</strong>

          <button
            type="button"
            onClick={handleApprovePayment}
            disabled={paymentSending}
          >
            {paymentSending
              ? 'Waiting for wallet approval...'
              : 'Approve & Pay'}
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

    {/* UNIVERSAL CHECKOUT - TIDEPOOL SANDBOX */}
    <div className="panel" id="universal-checkout">
      <div className="panel-heading">
        <h3>Universal Checkout</h3>
        <span className="coming-soon">Tidepool Sandbox</span>
      </div>

      <p className="panel-description">
        Preview a USDC to wNEAR conversion on NEAR Testnet.
      </p>

      <form onSubmit={handleTidepoolQuote}>
        <label>USDC AMOUNT</label>
        <input
          type="number"
          min="0.000001"
          step="0.000001"
          value={tidepoolAmount}
          onChange={(e) => setTidepoolAmount(e.target.value)}
          placeholder="e.g. 10"
          required
        />

        <small>
          Network: NEAR Testnet · Quote preview only
        </small>

        <button
          type="submit"
          className="primary-button"
          disabled={tidepoolLoading}
        >
          {tidepoolLoading
            ? 'Getting quote...'
            : 'Get Conversion Quote'}
        </button>
      </form>

      {tidepoolError && (
        <div className="request-feedback">
          <p>{tidepoolError}</p>
        </div>
      )}
{tidepoolQuote && (
  <div className="request-feedback">
    <h4>Conversion Quote</h4>

    <p>
      <strong>Input:</strong>{" "}
      {tidepoolQuote.quote?.amountInFormatted} USDC
    </p>

    <p>
      <strong>Estimated output:</strong>{" "}
     {Number(tidepoolQuote.quote?.amountOutFormatted || 0).toLocaleString(undefined, {
  maximumFractionDigits: 6,
})} wNEAR
    </p>

    <p>
      <strong>Minimum output:</strong>{" "}
      {tidepoolQuote.quote?.minAmountOutFormatted || "Not provided"} wNEAR
    </p>

    <p>
      <strong>Estimated time:</strong>{" "}
      {tidepoolQuote.quote?.timeEstimate ?? "Not provided"} seconds
    </p>

    <small>
      Tidepool community sandbox quote. No funds have been transferred.
    </small>
  </div>
)}
  </div>
    {/* PAYMENT ACTIVITY */}
    <div className="panel" id="payments">
      <div className="panel-heading">
        <h3>Payment Activity</h3>
        <span className="coming-soon">Testnet</span>
      </div>

      {paymentTransactions.length === 0 ? (
        <div className="empty-state compact">
          <div>⇄</div>
          <h4>No transactions yet</h4>
          <p>
            Approved NEAR testnet transactions will appear here.
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
              <p>Transaction: {tx.hash.slice(0, 12)}...</p>
              <p>{tx.date}</p>

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
      <span>OutLayer TEE</span>
      <span className="pending">Not configured</span>
    </div>

    <div className="security-row">
      <span>Spending policies</span>
      <span className="pending">Not configured</span>
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

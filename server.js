const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();

// =============================
// CORS
// =============================
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-partner-key"],
  })
);

app.use(express.json());

// =============================
// SUPABASE
// =============================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// =============================
// LIVELLI
// =============================
const LEVELS = [
  { name: "basic", min: 0, cashback: 2 },
  { name: "bronze", min: 100, cashback: 3 },
  { name: "silver", min: 500, cashback: 4 },
  { name: "gold", min: 1000, cashback: 5 },
  { name: "platino", min: 2500, cashback: 6 },
  { name: "vip", min: 5000, cashback: 7 },
  { name: "elite", min: 10000, cashback: 7 },
  { name: "diamond", min: 25000, cashback: 6 },
  { name: "millionaire", min: 50000, cashback: 5 },
];

function getLevelFromSpent(totalSpent) {
  const spent = Number(totalSpent || 0);
  let currentLevel = LEVELS[0];

  for (const level of LEVELS) {
    if (spent >= level.min) {
      currentLevel = level;
    }
  }

  return currentLevel;
}

function getCashbackPercentFromLevel(levelName) {
  const level = LEVELS.find(
    (l) => l.name.toLowerCase() === String(levelName || "").toLowerCase()
  );

  return Number(level?.cashback || 0);
}

function calculateGufoEarned(amountEuro, cashbackPercent) {
  const amount = Number(amountEuro || 0);
  const percent = Number(cashbackPercent || 0);

  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(percent) || percent <= 0) return 0;

  return Number(((amount * percent) / 100).toFixed(2));
}

function getDowngradedLevel(currentLevelName) {
  const index = LEVELS.findIndex(
    (l) => l.name.toLowerCase() === String(currentLevelName || "").toLowerCase()
  );

  if (index === -1) return LEVELS[0];

  const currentName = LEVELS[index].name.toLowerCase();

  if (
    currentName === "vip" ||
    currentName === "elite" ||
    currentName === "diamond" ||
    currentName === "millionaire"
  ) {
    return LEVELS[Math.max(index - 1, 0)];
  }

  return LEVELS[Math.max(index - 2, 0)];
}

// =============================
// HELPERS STAGIONE
// =============================
function quarterToIsoStart(value) {
  const match = /^(\d{4})-Q([1-4])$/.exec(String(value || "").trim());
  if (!match) return null;

  const year = Number(match[1]);
  const quarter = Number(match[2]);

  const monthMap = {
    1: "01",
    2: "04",
    3: "07",
    4: "10",
  };

  return `${year}-${monthMap[quarter]}-01T00:00:00.000Z`;
}

function normalizeSeasonStart(value) {
  if (!value) return null;

  const str = String(value).trim();

  const quarterIso = quarterToIsoStart(str);
  if (quarterIso) return quarterIso;

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return null;
}

function getCurrentQuarterString() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  let quarter = 1;
  if (month >= 3 && month <= 5) quarter = 2;
  else if (month >= 6 && month <= 8) quarter = 3;
  else if (month >= 9) quarter = 4;

  return `${year}-Q${quarter}`;
}

function isSeasonExpired(lastSeasonReset) {
  if (!lastSeasonReset) return true;

  const str = String(lastSeasonReset).trim();

  if (/^\d{4}-Q[1-4]$/.test(str)) {
    return str !== getCurrentQuarterString();
  }

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    const now = new Date();
    const diffMs = now - parsed;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays >= 90;
  }

  return true;
}

// =============================
// HELPERS LETTURA CAMPI
// =============================
function toNumberSafe(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function firstDefined(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return null;
}

function getTxId(tx) {
  return firstDefined(tx, ["id", "transaction_id"]) || null;
}

function getTxType(tx) {
  return (
    firstDefined(tx, ["type", "tipo", "transaction_type", "kind"]) || "-"
  );
}

function getTxMerchant(tx) {
  return (
    firstDefined(tx, [
      "merchant_name",
      "benefit",
      "brand",
      "merchant",
      "store_name",
      "partner_name",
    ]) || "-"
  );
}

function getTxAmount(tx) {
  const rawAmount = firstDefined(tx, [
    "amount_euro",
    "amount",
    "importo",
    "amount_eur",
    "eur_amount",
    "value",
  ]);

  return toNumberSafe(rawAmount);
}

function getTxGufo(tx) {
  const directGufo = toNumberSafe(
    firstDefined(tx, [
      "gufo_earned",
      "gufo",
      "gufo_amount",
      "cashback_amount",
      "reward_amount",
    ])
  );

  if (directGufo > 0) return directGufo;

  const amount = getTxAmount(tx);
  const cashbackPercent = toNumberSafe(
    firstDefined(tx, ["cashback_percent", "cashback"])
  );

  if (amount > 0 && cashbackPercent > 0) {
    return Number(((amount * cashbackPercent) / 100).toFixed(2));
  }

  return 0;
}

function getTxDate(tx) {
  return (
    firstDefined(tx, [
      "created_at",
      "date",
      "transaction_date",
      "inserted_at",
    ]) || null
  );
}

function normalizeTransaction(tx) {
  return {
    id: getTxId(tx),
    type: getTxType(tx),
    merchant_name: getTxMerchant(tx),
    amount_euro: getTxAmount(tx),
    gufo_earned: getTxGufo(tx),
    created_at: getTxDate(tx),
    partner_id: firstDefined(tx, ["partner_id"]) || null,
    category: firstDefined(tx, ["category"]) || null,
    cashback_percent: toNumberSafe(
      firstDefined(tx, ["cashback", "cashback_percent"])
    ),
    raw: tx,
  };
}

// =============================
// DB
// =============================
async function getProfileByCustomerCode(customerCode) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, customer_code, last_season_reset")
    .eq("customer_code", customerCode)
    .single();

  if (error) {
    throw new Error(`Errore profile: ${error.message}`);
  }

  return data;
}

async function getProfileById(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, customer_code, last_season_reset")
    .eq("id", userId)
    .single();

  if (error) {
    throw new Error(`Errore profile: ${error.message}`);
  }

  return data;
}

async function resolveUserId(userIdOrCode) {
  const value = String(userIdOrCode || "").trim();

  if (!value) {
    throw new Error("userId mancante");
  }

  if (value.startsWith("GUFO-")) {
    const profile = await getProfileByCustomerCode(value);
    return profile.id;
  }

  return value;
}

async function getProfile(userIdOrCode) {
  const userId = await resolveUserId(userIdOrCode);
  return await getProfileById(userId);
}

async function getWallet(userIdOrCode) {
  const userId = await resolveUserId(userIdOrCode);

  const { data, error } = await supabase
    .from("wallet")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error) {
    throw new Error(`Errore wallet: ${error.message}`);
  }

  return data;
}

async function getTransactions(userIdOrCode) {
  const userId = await resolveUserId(userIdOrCode);

  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Errore transactions: ${error.message}`);
  }

  return (data || []).map(normalizeTransaction);
}

async function getPartnerByName(partnerName) {
  const name = String(partnerName || "").trim();
  if (!name) return null;

  const { data, error } = await supabase
    .from("partners")
    .select("id, name, category, cashback_percent")
    .ilike("name", name)
    .single();

  if (error) {
    return null;
  }

  return data;
}

function sumAmount(transactions) {
  return transactions.reduce((sum, tx) => sum + toNumberSafe(tx.amount_euro), 0);
}

function sumGufo(transactions) {
  return transactions.reduce((sum, tx) => sum + toNumberSafe(tx.gufo_earned), 0);
}

function buildMonthlyExpenses(transactions) {
  const monthlyExpenses = Array(12).fill(0);

  transactions.forEach((tx) => {
    const dateValue = tx.created_at;
    const date = new Date(dateValue);

    if (!Number.isNaN(date.getTime())) {
      const month = date.getMonth();
      monthlyExpenses[month] += toNumberSafe(tx.amount_euro);
    }
  });

  return monthlyExpenses.map((v) => Number(v.toFixed(2)));
}

function filterSeasonTransactions(transactions, seasonStart) {
  if (!seasonStart) return transactions;

  const startDate = new Date(seasonStart);

  return transactions.filter((tx) => {
    const txDate = new Date(tx.created_at);
    return !Number.isNaN(txDate.getTime()) && txDate >= startDate;
  });
}

async function getSeasonStats(userId) {
  const profile = await getProfile(userId);
  const allTransactions = await getTransactions(userId);
  const seasonStart = normalizeSeasonStart(profile.last_season_reset);
  const seasonTransactions = filterSeasonTransactions(allTransactions, seasonStart);
  const seasonSpent = sumAmount(seasonTransactions);
  const currentLevel = getLevelFromSpent(seasonSpent);

  return {
    profile,
    allTransactions,
    seasonTransactions,
    seasonSpent,
    currentLevel,
  };
}

// =============================
// DOWNGRADE
// =============================
async function applySeasonDowngradeIfNeeded(userId) {
  const profile = await getProfile(userId);

  if (!isSeasonExpired(profile.last_season_reset)) {
    return {
      season_reset_done: false,
      last_season_reset: profile.last_season_reset,
    };
  }

  const seasonStats = await getSeasonStats(userId);
  const downgradedLevel = getDowngradedLevel(seasonStats.currentLevel.name);
  const newSeasonValue = getCurrentQuarterString();

  const { error } = await supabase
    .from("profiles")
    .update({
      last_season_reset: newSeasonValue,
    })
    .eq("id", profile.id);

  if (error) {
    throw new Error(`Errore update profile season reset: ${error.message}`);
  }

  return {
    season_reset_done: true,
    previous_level: seasonStats.currentLevel.name,
    downgraded_level: downgradedLevel.name,
    last_season_reset: newSeasonValue,
  };
}

// =============================
// ROUTES
// =============================
app.get("/", (req, res) => {
  res.json({ message: "GUFO backend attivo" });
});

app.get("/debug/transactions/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const txs = await getTransactions(userId);

    res.json({
      count: txs.length,
      sample: txs.slice(0, 5).map((tx) => ({
        id: tx.id,
        type: tx.type,
        merchant_name: tx.merchant_name,
        amount_euro: tx.amount_euro,
        gufo_earned: tx.gufo_earned,
        created_at: tx.created_at,
        partner_id: tx.partner_id,
        category: tx.category,
        raw: tx.raw,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/wallet/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    await applySeasonDowngradeIfNeeded(userId);

    const wallet = await getWallet(userId);
    const seasonStats = await getSeasonStats(userId);

    res.json({
      ...wallet,
      season_spent: Number(seasonStats.seasonSpent.toFixed(2)),
      current_level: seasonStats.currentLevel.name,
      cashback_percent: seasonStats.currentLevel.cashback,
      last_season_reset: seasonStats.profile.last_season_reset,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/transactions/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const transactions = await getTransactions(userId);
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    await applySeasonDowngradeIfNeeded(userId);

    const wallet = await getWallet(userId);
    const profile = await getProfile(userId);
    const allTransactions = await getTransactions(userId);

    const seasonStart = normalizeSeasonStart(profile.last_season_reset);
    const seasonTransactions = filterSeasonTransactions(allTransactions, seasonStart);

    const totalSpent = sumAmount(allTransactions);
    const totalGufoEarned = sumGufo(allTransactions);
    const seasonSpent = sumAmount(seasonTransactions);
    const currentLevel = getLevelFromSpent(seasonSpent);
    const recentTransactions = allTransactions.slice(0, 10);
    const monthlyExpenses = buildMonthlyExpenses(allTransactions);

    res.json({
      wallet: {
        ...wallet,
        season_spent: Number(seasonSpent.toFixed(2)),
        current_level: currentLevel.name,
        cashback_percent: currentLevel.cashback,
      },
      transactions: recentTransactions,
      stats: {
        total_transactions: allTransactions.length,
        total_spent: Number(totalSpent.toFixed(2)),
        gufo_earned: Number(totalGufoEarned.toFixed(2)),
        balance_gufo: Number(wallet.balance_gufo || 0),
        balance_eur: Number(wallet.balance_eur || 0),
        season_spent: Number(seasonSpent.toFixed(2)),
        level: currentLevel.name,
        cashback_percent: currentLevel.cashback,
        monthlyExpenses,
        last_season_reset: profile.last_season_reset,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/profile/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    await applySeasonDowngradeIfNeeded(userId);

    const profile = await getProfile(userId);
    const wallet = await getWallet(userId);
    const allTransactions = await getTransactions(userId);

    const seasonStart = normalizeSeasonStart(profile.last_season_reset);
    const seasonTransactions = filterSeasonTransactions(allTransactions, seasonStart);

    const seasonSpent = sumAmount(seasonTransactions);
    const currentLevel = getLevelFromSpent(seasonSpent);
    const recentTransactions = allTransactions.slice(0, 10);

    res.json({
      profile,
      wallet: {
        ...wallet,
        season_spent: Number(seasonSpent.toFixed(2)),
        current_level: currentLevel.name,
        cashback_percent: currentLevel.cashback,
      },
      stats: {
        balance_gufo: Number(wallet.balance_gufo || 0),
        balance_eur: Number(wallet.balance_eur || 0),
        season_spent: Number(seasonSpent.toFixed(2)),
        cashback_percent: currentLevel.cashback,
        level: currentLevel.name,
      },
      transactions: recentTransactions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/partner/customer", async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).json({ error: "Codice cliente obbligatorio" });
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, customer_code")
      .eq("customer_code", code)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Cliente non trovato" });
    }

    await applySeasonDowngradeIfNeeded(data.id);

    const wallet = await getWallet(data.id);
    const seasonStats = await getSeasonStats(data.id);

    return res.json({
      id: data.id,
      customer_code: data.customer_code,
      balance_gufo: Number(wallet.balance_gufo || 0),
      balance_eur: Number(wallet.balance_eur || 0),
      level: seasonStats.currentLevel.name,
      cashback_percent: seasonStats.currentLevel.cashback,
      season_spent: Number(seasonStats.seasonSpent.toFixed(2)),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/simulate-payment", async (req, res) => {
  try {
    const { user_id, amount_euro, merchant_name } = req.body;

    if (!user_id || amount_euro === undefined || amount_euro === null) {
      return res.status(400).json({
        error: "user_id e amount_euro sono obbligatori",
      });
    }

    const amount = Number(amount_euro);

    if (Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        error: "amount_euro deve essere un numero maggiore di 0",
      });
    }

    const resolvedUserId = await resolveUserId(user_id);

    await applySeasonDowngradeIfNeeded(resolvedUserId);

    const wallet = await getWallet(resolvedUserId);
    const seasonStats = await getSeasonStats(resolvedUserId);

    const cashbackPercent = getCashbackPercentFromLevel(
      seasonStats.currentLevel.name
    );

    const gufoEarned = calculateGufoEarned(amount, cashbackPercent);

    const newBalanceGufo = Number(
      (Number(wallet.balance_gufo || 0) + gufoEarned).toFixed(2)
    );

    const partner = await getPartnerByName(merchant_name);
    const finalMerchantName = partner?.name || merchant_name || "Merchant Test";
    const finalCategory = partner?.category || null;
    const finalPartnerId = partner?.id || null;

    const { error: walletUpdateError } = await supabase
      .from("wallet")
      .update({
        balance_gufo: newBalanceGufo,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", resolvedUserId);

    if (walletUpdateError) {
      return res.status(500).json({ error: walletUpdateError.message });
    }

    const { data: transaction, error: transactionError } = await supabase
      .from("transactions")
      .insert([
        {
          user_id: resolvedUserId,
          amount: amount,
          gufo_earned: gufoEarned,
          cashback: cashbackPercent,
          partner_id: finalPartnerId,
          benefit: finalMerchantName,
          category: finalCategory,
          tipo: "cashback",
          created_at: new Date().toISOString(),
          status: "completed",
        },
      ])
      .select()
      .single();

    if (transactionError) {
      return res.status(500).json({ error: transactionError.message });
    }

    const updatedSeasonStats = await getSeasonStats(resolvedUserId);

    res.json({
      success: true,
      message: "Pagamento simulato con successo",
      transaction,
      wallet: {
        balance_gufo: Number(newBalanceGufo.toFixed(2)),
        balance_eur: Number(wallet.balance_eur || 0),
        season_spent: Number(updatedSeasonStats.seasonSpent.toFixed(2)),
        level: updatedSeasonStats.currentLevel.name,
        cashback_percent: updatedSeasonStats.currentLevel.cashback,
        gufo_earned: gufoEarned,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/transaction", async (req, res) => {
  try {
    const partnerApiKey = req.headers["x-partner-key"];

    if (!partnerApiKey || partnerApiKey !== process.env.PARTNER_API_KEY) {
      return res.status(401).json({
        error: "Partner non autorizzato",
      });
    }

    const { user_id, amount, merchant_name } = req.body;

    if (!user_id || amount === undefined || amount === null) {
      return res.status(400).json({
        error: "user_id e amount sono obbligatori",
      });
    }

    const value = Number(amount);

    if (Number.isNaN(value) || value <= 0) {
      return res.status(400).json({
        error: "amount deve essere maggiore di 0",
      });
    }

    const resolvedUserId = await resolveUserId(user_id);

    await applySeasonDowngradeIfNeeded(resolvedUserId);

    const wallet = await getWallet(resolvedUserId);
    const seasonStats = await getSeasonStats(resolvedUserId);

    const cashbackPercent = getCashbackPercentFromLevel(
      seasonStats.currentLevel.name
    );

    const gufoEarned = calculateGufoEarned(value, cashbackPercent);

    const newBalanceGufo = Number(
      (Number(wallet.balance_gufo || 0) + gufoEarned).toFixed(2)
    );

    const partner = await getPartnerByName(merchant_name);
    const finalMerchantName = partner?.name || merchant_name || "Partner";
    const finalCategory = partner?.category || null;
    const finalPartnerId = partner?.id || null;

    const { error: walletUpdateError } = await supabase
      .from("wallet")
      .update({
        balance_gufo: newBalanceGufo,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", resolvedUserId);

    if (walletUpdateError) {
      return res.status(500).json({ error: walletUpdateError.message });
    }

    const { data: transaction, error: transactionError } = await supabase
      .from("transactions")
      .insert([
        {
          user_id: resolvedUserId,
          amount: value,
          gufo_earned: gufoEarned,
          cashback: cashbackPercent,
          partner_id: finalPartnerId,
          benefit: finalMerchantName,
          category: finalCategory,
          tipo: "cashback",
          created_at: new Date().toISOString(),
          status: "completed",
        },
      ])
      .select()
      .single();

    if (transactionError) {
      return res.status(500).json({ error: transactionError.message });
    }

    res.json({
      success: true,
      transaction,
      gufo_earned: gufoEarned,
      new_balance: newBalanceGufo,
      partner_id: finalPartnerId,
      merchant_name: finalMerchantName,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/season-reset/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const before = await getSeasonStats(userId);
    const result = await applySeasonDowngradeIfNeeded(userId);
    const after = await getSeasonStats(userId);

    res.json({
      success: true,
      message: result.season_reset_done
        ? "Downgrade stagionale applicato"
        : "Stagione non ancora scaduta, nessun reset eseguito",
      before: {
        season_spent: Number(before.seasonSpent.toFixed(2)),
        level: before.currentLevel.name,
        cashback_percent: before.currentLevel.cashback,
      },
      reset_result: result,
      after: {
        season_spent: Number(after.seasonSpent.toFixed(2)),
        level: after.currentLevel.name,
        cashback_percent: after.currentLevel.cashback,
        last_season_reset: after.profile.last_season_reset,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/partner/stats", async (req, res) => {
  try {
    const partnerId = req.query.partner_id
      ? Number(req.query.partner_id)
      : null;

    let query = supabase
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false });

    if (partnerId) {
      query = query.eq("partner_id", partnerId);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const transactions = (data || []).map(normalizeTransaction);

    const totalTransactions = transactions.length;

    const totalAmount = transactions.reduce(
      (sum, tx) => sum + Number(tx.amount_euro || 0),
      0
    );

    const totalGufo = transactions.reduce(
      (sum, tx) => sum + Number(tx.gufo_earned || 0),
      0
    );

    const recentTransactions = transactions.slice(0, 10);

    res.json({
      total_transactions: totalTransactions,
      total_amount: Number(totalAmount.toFixed(2)),
      total_gufo_distributed: Number(totalGufo.toFixed(2)),
      recent_transactions: recentTransactions,
      partner_id: partnerId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================
// ERROR HANDLER
// =============================
app.use((err, req, res, next) => {
  console.error("Errore server:", err.message);
  res.status(500).json({
    error: err.message || "Errore interno del server",
  });
});

// =============================
// START SERVER
// =============================
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server attivo sulla porta ${PORT}`);
});
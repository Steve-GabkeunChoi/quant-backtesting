function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function normalizeNumber(value) {
  if (value === undefined || value === null) return NaN;
  const cleaned = String(value)
    .replace(/"/g, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .replace(/%/g, '');
  return Number(cleaned);
}

function normalizeDate(value) {
  return String(value).replace(/"/g, '').trim().replaceAll('.', '/').replaceAll('-', '/');
}

function parseKrxCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('CSV 데이터가 비어 있습니다.');
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/"/g, '').trim());
  const required = ['일자', '종가', '시가', '고가', '저가', '거래량'];
  const missing = required.filter((name) => !headers.includes(name));
  if (missing.length > 0) {
    throw new Error(`KRX CSV 필수 컬럼이 없습니다: ${missing.join(', ')}`);
  }

  const index = Object.fromEntries(headers.map((name, idx) => [name, idx]));
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row = {
      date: normalizeDate(cols[index['일자']]),
      open: normalizeNumber(cols[index['시가']]),
      high: normalizeNumber(cols[index['고가']]),
      low: normalizeNumber(cols[index['저가']]),
      close: normalizeNumber(cols[index['종가']]),
      volume: normalizeNumber(cols[index['거래량']]),
    };

    if ([row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite)) {
      rows.push(row);
    }
  }

  if (rows.length < 30) {
    throw new Error('백테스팅을 수행하기에는 데이터가 부족합니다. 최소 30개 이상의 일별 데이터가 필요합니다.');
  }

  rows.sort((a, b) => new Date(a.date) - new Date(b.date));
  return rows;
}

function movingAverage(values, period) {
  const result = Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }

  return result;
}

function calculateRsi(values, period) {
  const rsi = Array(values.length).fill(null);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsi;
}

function calculateMdd(equityCurve) {
  let peak = -Infinity;
  let mdd = 0;

  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const drawdown = (point.equity - peak) / peak;
    if (drawdown < mdd) mdd = drawdown;
  }

  return mdd;
}

function summarizeTrades(trades) {
  const closed = trades.filter((trade) => trade.type === 'SELL' || trade.type === 'DAY_SELL');
  const wins = closed.filter((trade) => trade.returnRate > 0).length;
  return {
    tradeCount: trades.length,
    closedTradeCount: closed.length,
    winRate: closed.length ? wins / closed.length : 0,
  };
}

function buyAll(cash, price, feeRate) {
  const quantity = Math.floor(cash / (price * (1 + feeRate)));
  const cost = quantity * price;
  const fee = cost * feeRate;
  return { quantity, cost, fee, cashAfter: cash - cost - fee };
}

function backtestMovingAverage(data, options) {
  const shortPeriod = Number(options.shortMa);
  const longPeriod = Number(options.longMa);
  if (shortPeriod >= longPeriod) {
    throw new Error('단기 이동평균은 장기 이동평균보다 작아야 합니다.');
  }

  const closes = data.map((row) => row.close);
  const shortMa = movingAverage(closes, shortPeriod);
  const longMa = movingAverage(closes, longPeriod);
  let cash = Number(options.initialCapital);
  let shares = 0;
  let entryPrice = 0;
  const trades = [];
  const equityCurve = [];

  for (let i = 0; i < data.length; i += 1) {
    const row = data[i];
    const price = row.close;

    if (i > 0 && shortMa[i - 1] !== null && longMa[i - 1] !== null && shortMa[i] !== null && longMa[i] !== null) {
      const wasBelow = shortMa[i - 1] <= longMa[i - 1];
      const nowAbove = shortMa[i] > longMa[i];
      const wasAbove = shortMa[i - 1] >= longMa[i - 1];
      const nowBelow = shortMa[i] < longMa[i];

      if (shares === 0 && wasBelow && nowAbove) {
        const order = buyAll(cash, price, options.feeRate);
        if (order.quantity > 0) {
          shares = order.quantity;
          cash = order.cashAfter;
          entryPrice = price;
          trades.push({ date: row.date, type: 'BUY', price, quantity: shares, amount: order.cost, returnRate: null });
        }
      } else if (shares > 0 && wasAbove && nowBelow) {
        const amount = shares * price;
        const fee = amount * options.feeRate;
        cash += amount - fee;
        const returnRate = (price - entryPrice) / entryPrice;
        trades.push({ date: row.date, type: 'SELL', price, quantity: shares, amount, returnRate });
        shares = 0;
        entryPrice = 0;
      }
    }

    equityCurve.push({ date: row.date, equity: cash + shares * price });
  }

  if (shares > 0) {
    const last = data[data.length - 1];
    const amount = shares * last.close;
    const fee = amount * options.feeRate;
    cash += amount - fee;
    const returnRate = (last.close - entryPrice) / entryPrice;
    trades.push({ date: last.date, type: 'SELL', price: last.close, quantity: shares, amount, returnRate });
    equityCurve[equityCurve.length - 1].equity = cash;
  }

  return buildResult(data, cash, equityCurve, trades, { shortMa, longMa });
}

function backtestRsi(data, options) {
  const period = Number(options.rsiPeriod);
  const buyLevel = Number(options.rsiBuy);
  const sellLevel = Number(options.rsiSell);
  if (buyLevel >= sellLevel) {
    throw new Error('RSI 매수 기준은 매도 기준보다 낮아야 합니다.');
  }

  const closes = data.map((row) => row.close);
  const rsi = calculateRsi(closes, period);
  let cash = Number(options.initialCapital);
  let shares = 0;
  let entryPrice = 0;
  const trades = [];
  const equityCurve = [];

  for (let i = 0; i < data.length; i += 1) {
    const row = data[i];
    const price = row.close;

    if (rsi[i] !== null) {
      if (shares === 0 && rsi[i] <= buyLevel) {
        const order = buyAll(cash, price, options.feeRate);
        if (order.quantity > 0) {
          shares = order.quantity;
          cash = order.cashAfter;
          entryPrice = price;
          trades.push({ date: row.date, type: 'BUY', price, quantity: shares, amount: order.cost, returnRate: null });
        }
      } else if (shares > 0 && rsi[i] >= sellLevel) {
        const amount = shares * price;
        const fee = amount * options.feeRate;
        cash += amount - fee;
        const returnRate = (price - entryPrice) / entryPrice;
        trades.push({ date: row.date, type: 'SELL', price, quantity: shares, amount, returnRate });
        shares = 0;
        entryPrice = 0;
      }
    }

    equityCurve.push({ date: row.date, equity: cash + shares * price });
  }

  if (shares > 0) {
    const last = data[data.length - 1];
    const amount = shares * last.close;
    const fee = amount * options.feeRate;
    cash += amount - fee;
    const returnRate = (last.close - entryPrice) / entryPrice;
    trades.push({ date: last.date, type: 'SELL', price: last.close, quantity: shares, amount, returnRate });
    equityCurve[equityCurve.length - 1].equity = cash;
  }

  return buildResult(data, cash, equityCurve, trades, { rsi });
}

function backtestBreakout(data, options) {
  const k = Number(options.breakoutK);
  let cash = Number(options.initialCapital);
  const trades = [];
  const equityCurve = [{ date: data[0].date, equity: cash }];

  for (let i = 1; i < data.length; i += 1) {
    const prev = data[i - 1];
    const row = data[i];
    const target = prev.close + (prev.high - prev.low) * k;

    if (row.high >= target) {
      const buyPrice = Math.max(row.open, target);
      const buyOrder = buyAll(cash, buyPrice, options.feeRate);

      if (buyOrder.quantity > 0) {
        const sellPrice = row.close;
        const sellAmount = buyOrder.quantity * sellPrice;
        const sellFee = sellAmount * options.feeRate;
        const returnRate = (sellPrice - buyPrice) / buyPrice;

        trades.push({ date: row.date, type: 'DAY_BUY', price: buyPrice, quantity: buyOrder.quantity, amount: buyOrder.cost, returnRate: null });
        trades.push({ date: row.date, type: 'DAY_SELL', price: sellPrice, quantity: buyOrder.quantity, amount: sellAmount, returnRate });

        cash = buyOrder.cashAfter + sellAmount - sellFee;
      }
    }

    equityCurve.push({ date: row.date, equity: cash });
  }

  return buildResult(data, cash, equityCurve, trades, {});
}

function buildResult(data, finalCapital, equityCurve, trades, indicators) {
  const initialCapital = equityCurve[0].equity;
  const totalReturn = (finalCapital - initialCapital) / initialCapital;
  const buyHoldReturn = (data[data.length - 1].close - data[0].close) / data[0].close;
  const mdd = calculateMdd(equityCurve);
  const tradeSummary = summarizeTrades(trades);

  return {
    finalCapital,
    totalReturn,
    buyHoldReturn,
    mdd,
    trades,
    equityCurve,
    indicators,
    ...tradeSummary,
  };
}

window.KrxBacktest = {
  parseKrxCsv,
  backtestMovingAverage,
  backtestRsi,
  backtestBreakout,
};

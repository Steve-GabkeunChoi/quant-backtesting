let currentData = [];
let currentSourceName = '';
let priceChart = null;
let equityChart = null;

const elements = {
  stockName: document.getElementById('stockName'),
  csvFile: document.getElementById('csvFile'),
  dataStatus: document.getElementById('dataStatus'),
  strategyType: document.getElementById('strategyType'),
  maOptions: document.getElementById('maOptions'),
  rsiOptions: document.getElementById('rsiOptions'),
  breakoutOptions: document.getElementById('breakoutOptions'),
  runBtn: document.getElementById('runBtn'),
  finalCapital: document.getElementById('finalCapital'),
  totalReturn: document.getElementById('totalReturn'),
  buyHoldReturn: document.getElementById('buyHoldReturn'),
  mdd: document.getElementById('mdd'),
  tradeCount: document.getElementById('tradeCount'),
  winRate: document.getElementById('winRate'),
  resultComment: document.getElementById('resultComment'),
  tradeTableBody: document.getElementById('tradeTableBody'),
};

function formatCurrency(value) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value) {
  return Number(value).toLocaleString('ko-KR');
}

function decodeCsvBuffer(buffer) {
  const encodings = ['euc-kr', 'utf-8'];

  for (const encoding of encodings) {
    try {
      const text = new TextDecoder(encoding).decode(buffer);
      if (text.includes('일자') && text.includes('종가')) {
        return text;
      }
    } catch (error) {
      // 다른 인코딩을 계속 시도한다.
    }
  }

  return new TextDecoder('utf-8').decode(buffer);
}

async function readFileAsText(file) {
  const buffer = await file.arrayBuffer();
  return decodeCsvBuffer(buffer);
}

function applyCsv(csvText, sourceName) {
  currentData = window.KrxBacktest.parseKrxCsv(csvText);
  currentSourceName = sourceName;

  const first = currentData[0];
  const last = currentData[currentData.length - 1];
  const stockLabel = elements.stockName.value.trim() || sourceName;

  elements.dataStatus.textContent = `${stockLabel} 데이터 로드 완료: ${currentData.length}건, 기간 ${first.date} ~ ${last.date}`;
  drawPriceChart(currentData, {});
  drawEquityChart([]);
  resetResult();
}

function resetResult() {
  elements.finalCapital.textContent = '-';
  elements.totalReturn.textContent = '-';
  elements.buyHoldReturn.textContent = '-';
  elements.mdd.textContent = '-';
  elements.tradeCount.textContent = '-';
  elements.winRate.textContent = '-';
  elements.resultComment.textContent = 'KRX CSV 파일을 불러온 뒤 백테스팅을 실행합니다.';
  elements.tradeTableBody.innerHTML = '<tr><td colspan="6">거래 내역이 없습니다.</td></tr>';
}

function getOptions() {
  return {
    strategyType: elements.strategyType.value,
    shortMa: Number(document.getElementById('shortMa').value),
    longMa: Number(document.getElementById('longMa').value),
    rsiPeriod: Number(document.getElementById('rsiPeriod').value),
    rsiBuy: Number(document.getElementById('rsiBuy').value),
    rsiSell: Number(document.getElementById('rsiSell').value),
    breakoutK: Number(document.getElementById('breakoutK').value),
    initialCapital: Number(document.getElementById('initialCapital').value),
    feeRate: Number(document.getElementById('feeRate').value),
  };
}

function validateOptions(options) {
  if (!Number.isFinite(options.initialCapital) || options.initialCapital <= 0) {
    throw new Error('초기 투자금은 0보다 큰 숫자여야 합니다.');
  }

  if (!Number.isFinite(options.feeRate) || options.feeRate < 0) {
    throw new Error('거래 수수료율은 0 이상의 숫자여야 합니다.');
  }
}

function runBacktest() {
  if (currentData.length === 0) {
    alert('먼저 KRX CSV 파일을 불러오세요.');
    return;
  }

  const options = getOptions();
  validateOptions(options);

  let result;

  if (options.strategyType === 'ma') {
    result = window.KrxBacktest.backtestMovingAverage(currentData, options);
  } else if (options.strategyType === 'rsi') {
    result = window.KrxBacktest.backtestRsi(currentData, options);
  } else {
    result = window.KrxBacktest.backtestBreakout(currentData, options);
  }

  renderResult(result, options);
  drawPriceChart(currentData, result.indicators);
  drawEquityChart(result.equityCurve);
  renderTrades(result.trades);
}

function renderResult(result, options) {
  elements.finalCapital.textContent = formatCurrency(result.finalCapital);
  elements.totalReturn.textContent = formatPercent(result.totalReturn);
  elements.buyHoldReturn.textContent = formatPercent(result.buyHoldReturn);
  elements.mdd.textContent = formatPercent(result.mdd);
  elements.tradeCount.textContent = `${result.tradeCount}회`;
  elements.winRate.textContent = formatPercent(result.winRate);

  const strategyName = {
    ma: '이동평균 교차 전략',
    rsi: 'RSI 과매도·과매수 전략',
    breakout: '변동성 돌파 전략',
  }[options.strategyType];

  const stockLabel = elements.stockName.value.trim() || currentSourceName || '업로드 데이터';
  const compare = result.totalReturn >= result.buyHoldReturn
    ? '전략 수익률이 단순 보유 수익률보다 높습니다.'
    : '전략 수익률이 단순 보유 수익률보다 낮습니다.';

  elements.resultComment.textContent = `${stockLabel}에 ${strategyName}을 적용한 결과입니다. 누적 수익률은 ${formatPercent(result.totalReturn)}, Buy & Hold 수익률은 ${formatPercent(result.buyHoldReturn)}입니다. ${compare}`;
}

function renderTrades(trades) {
  if (trades.length === 0) {
    elements.tradeTableBody.innerHTML = '<tr><td colspan="6">전략 조건에 해당하는 거래가 발생하지 않았습니다.</td></tr>';
    return;
  }

  elements.tradeTableBody.innerHTML = trades.map((trade) => {
    const typeLabel = {
      BUY: '매수',
      SELL: '매도',
      DAY_BUY: '당일 매수',
      DAY_SELL: '당일 매도',
    }[trade.type] || trade.type;

    return `
      <tr>
        <td>${trade.date}</td>
        <td>${typeLabel}</td>
        <td>${formatNumber(trade.price)}</td>
        <td>${formatNumber(trade.quantity)}</td>
        <td>${formatCurrency(trade.amount)}</td>
        <td>${trade.returnRate === null ? '-' : formatPercent(trade.returnRate)}</td>
      </tr>
    `;
  }).join('');
}

function drawPriceChart(data, indicators) {
  const ctx = document.getElementById('priceChart');
  if (priceChart) priceChart.destroy();

  const labels = data.map((row) => row.date);
  const datasets = [
    {
      label: '종가',
      data: data.map((row) => row.close),
      borderWidth: 2,
      pointRadius: 0,
    },
  ];

  if (indicators?.shortMa) {
    datasets.push({ label: '단기 이동평균', data: indicators.shortMa, borderWidth: 1, pointRadius: 0 });
  }

  if (indicators?.longMa) {
    datasets.push({ label: '장기 이동평균', data: indicators.longMa, borderWidth: 1, pointRadius: 0 });
  }

  priceChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom' } },
      scales: { x: { ticks: { maxTicksLimit: 8 } } },
    },
  });
}

function drawEquityChart(equityCurve) {
  const ctx = document.getElementById('equityChart');
  if (equityChart) equityChart.destroy();

  equityChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: equityCurve.map((point) => point.date),
      datasets: [{ label: '자산', data: equityCurve.map((point) => point.equity), borderWidth: 2, pointRadius: 0 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom' } },
      scales: { x: { ticks: { maxTicksLimit: 8 } } },
    },
  });
}

function updateStrategyOptions() {
  const selected = elements.strategyType.value;
  elements.maOptions.classList.toggle('hidden', selected !== 'ma');
  elements.rsiOptions.classList.toggle('hidden', selected !== 'rsi');
  elements.breakoutOptions.classList.toggle('hidden', selected !== 'breakout');
}

elements.csvFile.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await readFileAsText(file);
    applyCsv(text, file.name);
  } catch (error) {
    currentData = [];
    elements.dataStatus.textContent = `CSV 로드 실패: ${error.message}`;
    resetResult();
  }
});

elements.strategyType.addEventListener('change', updateStrategyOptions);
elements.runBtn.addEventListener('click', () => {
  try {
    runBacktest();
  } catch (error) {
    alert(error.message);
  }
});

updateStrategyOptions();

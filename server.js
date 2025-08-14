require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { ROC, MACD, ATR, RSI } = require('technicalindicators');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// Nifty 50 symbols
const NIFTY_50 = [
  'RELIANCE.BSE', 'TCS.BSE', 'HDFCBANK.BSE', 'INFY.BSE', 'HINDUNILVR.BSE',
  'ICICIBANK.BSE', 'ITC.BSE', 'KOTAKBANK.BSE', 'SBIN.BSE', 'ASIANPAINT.BSE',
  'LT.BSE', 'MARUTI.BSE', 'AXISBANK.BSE', 'BAJFINANCE.BSE', 'WIPRO.BSE',
  'ONGC.BSE', 'SUNPHARMA.BSE', 'BHARTIARTL.BSE', 'NESTLEIND.BSE', 'ULTRACEMCO.BSE',
  'LUPIN.BSE', 'BAJAJ-AUTO.BSE', 'HCLTECH.BSE', 'INDUSINDBK.BSE', 'DRREDDY.BSE',
  'M&M.BSE', 'TATASTEEL.BSE', 'IOC.BSE', 'POWERGRID.BSE', 'NTPC.BSE',
  'COALINDIA.BSE', 'ADANIPORTS.BSE', 'TECHM.BSE', 'JSWSTEEL.BSE', 'TITAN.BSE',
  'HEROMOTOCO.BSE', 'GAIL.BSE', 'BPCL.BSE', 'SBILIFE.BSE', 'HDFCLIFE.BSE',
  'CIPLA.BSE', 'GRASIM.BSE', 'SHREECEM.BSE', 'DIVISLAB.BSE', 'UPL.BSE',
  'BRITANNIA.BSE', 'EICHERMOT.BSE', 'HINDALCO.BSE', 'VEDL.BSE'
];

// Fetch stock data from Alpha Vantage
async function fetchStockData(symbol) {
  try {
    const response = await axios.get(
      `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=5min&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`
    );
    return response.data;
  } catch (error) {
    console.error(`Error fetching data for ${symbol}:`, error.message);
    return null;
  }
}

// Calculate technical indicators
function calculateIndicators(data) {
  if (!data || !data['Time Series (5min)']) return null;
  
  const timeSeries = data['Time Series (5min)'];
  const closes = [];
  const highs = [];
  const lows = [];
  const volumes = [];
  
  Object.keys(timeSeries).forEach(timestamp => {
    const entry = timeSeries[timestamp];
    closes.push(parseFloat(entry['4. close']));
    highs.push(parseFloat(entry['2. high']));
    lows.push(parseFloat(entry['3. low']));
    volumes.push(parseFloat(entry['5. volume']));
  });
  
  // Reverse to get chronological order (oldest first)
  closes.reverse();
  highs.reverse();
  lows.reverse();
  volumes.reverse();
  
  // Calculate indicators
  const roc = ROC.calculate({ period: 5, values: closes });
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const rsi = RSI.calculate({ values: closes, period: 14 });
  
  return {
    closes,
    volumes,
    roc: roc.length > 0 ? roc[roc.length - 1] : 0,
    macd: macd.length > 0 ? macd[macd.length - 1] : { histogram: 0, MACD: 0, signal: 0 },
    atr: atr.length > 0 ? atr[atr.length - 1] : 0,
    rsi: rsi.length > 0 ? rsi[rsi.length - 1] : 0,
    lastPrice: closes[closes.length - 1],
    prevClose: closes.length > 1 ? closes[closes.length - 2] : closes[0]
  };
}

// Calculate probability and direction
function calculateProbability(indicators) {
  if (!indicators) return null;
  
  const { roc, macd, atr, rsi, volumes, lastPrice, prevClose } = indicators;
  
  // Calculate gap
  const gap = prevClose ? Math.abs((lastPrice - prevClose) / prevClose) : 0;
  
  // Calculate volume ratio
  const recentVolumes = volumes.slice(-10);
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
  const volumeRatio = volumes[volumes.length - 1] / avgVolume;
  
  // Calculate scores
  const volatilityScore = Math.min(1, atr / (lastPrice * 0.01));
  const momentumScore = Math.min(1, (Math.abs(roc) + Math.abs(macd.histogram)) / 2);
  const volumeScore = Math.min(1, volumeRatio / 1.5);
  const gapScore = Math.min(1, gap / 0.005);
  
  // Calculate probability
  let probability = Math.min(90, 
    (volatilityScore * 40) + 
    (momentumScore * 30) + 
    (volumeScore * 20) + 
    (gapScore * 10)
  );
  
  // Determine direction
  let direction = 'neutral';
  if (roc > 0 && macd.histogram > 0) {
    direction = 'buy';
    // Increase probability for strong momentum
    probability = Math.min(95, probability + 5);
  } else if (roc < 0 && macd.histogram < 0) {
    direction = 'sell';
  } else if (roc > 0) {
    direction = 'buy';
  } else if (roc < 0) {
    direction = 'sell';
  }
  
  return {
    probability: Math.round(probability),
    direction,
    indicators: {
      roc: parseFloat(roc.toFixed(2)),
      macd: parseFloat(macd.histogram.toFixed(2)),
      atr: parseFloat(atr.toFixed(2)),
      rsi: parseFloat(rsi.toFixed(1)),
      volumeRatio: parseFloat(volumeRatio.toFixed(2))
    }
  };
}

// API endpoint to get all stocks data
app.get('/api/stocks', async (req, res) => {
  try {
    const results = [];
    
    for (const symbol of NIFTY_50) {
      const rawData = await fetchStockData(symbol);
      const indicators = calculateIndicators(rawData);
      
      if (indicators) {
        const prediction = calculateProbability(indicators);
        const stockName = symbol.split('.')[0];
        
        if (prediction) {
          results.push({
            symbol: stockName,
            price: indicators.lastPrice,
            change: prevClose ? 
              ((indicators.lastPrice - indicators.prevClose) / indicators.prevClose * 100).toFixed(2) : 0,
            volatility: (indicators.atr / indicators.lastPrice * 100).toFixed(2),
            ...prediction
          });
        }
      }
      
      // Add delay to respect API rate limits (5 requests per minute)
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
    
    // Sort by highest probability
    results.sort((a, b) => b.probability - a.probability);
    
    res.json(results);
  } catch (error) {
    console.error('Error processing stocks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
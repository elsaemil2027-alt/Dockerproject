const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const port = process.env.PORT || 4000;
const startedAt = new Date();
const REQUEST_TIMEOUT_MS = 8000;

const MAJOR_TARGETS = [
  { id: 'github-api', name: 'GitHub API', url: 'https://api.github.com' },
  { id: 'npm-registry', name: 'NPM Registry', url: 'https://registry.npmjs.org' },
  { id: 'wikipedia-api', name: 'Wikipedia API', url: 'https://en.wikipedia.org/w/api.php?action=query&meta=siteinfo&format=json' },
  { id: 'jsonplaceholder', name: 'JSONPlaceholder API', url: 'https://jsonplaceholder.typicode.com/posts/1' },
  { id: 'open-meteo', name: 'Open-Meteo API', url: 'https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current=temperature_2m' }
];

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'"]
    }
  }
}));
app.use(compression());
app.use(express.json());
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

function getHealthPayload() {
  const memory = process.memoryUsage();
  const uptimeSeconds = process.uptime();

  return {
    status: 'ok',
    app: 'PulseGlass API Health Checker',
    timestamp: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    uptimeSeconds,
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
    memory: {
      rssMB: +(memory.rss / 1024 / 1024).toFixed(2),
      heapUsedMB: +(memory.heapUsed / 1024 / 1024).toFixed(2),
      heapTotalMB: +(memory.heapTotal / 1024 / 1024).toFixed(2)
    }
  };
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeServiceName(label, url) {
  if (typeof label === 'string' && label.trim()) {
    return label.trim().slice(0, 60);
  }

  try {
    return new URL(url).hostname;
  } catch {
    return 'Custom Target';
  }
}

async function checkTarget(target) {
  const start = process.hrtime.bigint();

  try {
    const response = await fetch(target.url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': 'PulseGlass-Health-Checker/1.0',
        accept: '*/*'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    const status = response.status;
    const reachable = status < 500;

    return {
      id: target.id,
      name: target.name,
      url: target.url,
      ok: reachable,
      status,
      latencyMs: +latencyMs.toFixed(2),
      checkedAt: new Date().toISOString(),
      error: null
    };
  } catch (error) {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;

    return {
      id: target.id,
      name: target.name,
      url: target.url,
      ok: false,
      status: null,
      latencyMs: +latencyMs.toFixed(2),
      checkedAt: new Date().toISOString(),
      error: error.name === 'TimeoutError' ? `Timed out after ${REQUEST_TIMEOUT_MS}ms` : error.message
    };
  }
}

app.get('/', (req, res) => {
  res.render('index', {
    title: 'PulseGlass | API Health Checker'
  });
});

app.get('/api/health', async (req, res) => {
  const start = process.hrtime.bigint();

  await new Promise((resolve) => setTimeout(resolve, 10));

  const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
  const payload = getHealthPayload();

  payload.latencyMs = +durationMs.toFixed(2);
  payload.healthScore = Math.max(
    60,
    Math.min(100, Math.round(100 - payload.memory.heapUsedMB / 2 - payload.latencyMs))
  );

  res.status(200).json(payload);
});

app.get('/api/targets', (req, res) => {
  res.json({
    targets: MAJOR_TARGETS
  });
});

app.get('/api/check', async (req, res) => {
  const url = req.query.url;
  const label = req.query.label;

  if (!url || typeof url !== 'string') {
    res.status(400).json({
      status: 'error',
      message: 'Missing query parameter: url'
    });
    return;
  }

  if (!isValidHttpUrl(url)) {
    res.status(400).json({
      status: 'error',
      message: 'Invalid URL. Use http:// or https://'
    });
    return;
  }

  const customTarget = {
    id: `custom-${Date.now()}`,
    name: normalizeServiceName(label, url),
    url
  };

  const result = await checkTarget(customTarget);
  res.status(result.ok ? 200 : 503).json(result);
});

app.get('/api/scan', async (req, res) => {
  const checks = await Promise.all(MAJOR_TARGETS.map((target) => checkTarget(target)));

  const upCount = checks.filter((item) => item.ok).length;
  const averageLatencyMs = checks.length
    ? +(checks.reduce((sum, item) => sum + item.latencyMs, 0) / checks.length).toFixed(2)
    : 0;

  res.json({
    status: upCount === checks.length ? 'ok' : 'degraded',
    summary: {
      total: checks.length,
      up: upCount,
      down: checks.length - upCount,
      averageLatencyMs
    },
    checkedAt: new Date().toISOString(),
    checks
  });
});

app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found',
    path: req.originalUrl
  });
});

app.listen(port, () => {
  console.log(`PulseGlass API Health Checker is running on http://localhost:${port}`);
});

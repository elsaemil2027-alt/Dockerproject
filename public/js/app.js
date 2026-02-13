const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const upValue = document.getElementById('up-value');
const downValue = document.getElementById('down-value');
const avgLatencyValue = document.getElementById('avg-latency-value');
const totalValue = document.getElementById('total-value');
const metaLine = document.getElementById('meta-line');
const refreshBtn = document.getElementById('refresh-btn');
const tbody = document.getElementById('status-tbody');
const customForm = document.getElementById('custom-check-form');
const customLabelInput = document.getElementById('custom-label');
const customUrlInput = document.getElementById('custom-url');
const customResult = document.getElementById('custom-result');
const customChecksByUrl = new Map();
let majorChecks = [];

function kineticTitle() {
  const title = document.getElementById('kinetic-title');
  if (!title) return;

  const text = title.textContent;
  title.textContent = '';

  [...text].forEach((char, i) => {
    const span = document.createElement('span');
    span.className = 'k-letter';
    span.textContent = char;
    span.style.animationDelay = `${i * 35}ms`;
    title.appendChild(span);
  });
}

function setPlatformStatus(allHealthy) {
  statusDot.classList.remove('ok', 'down');
  statusDot.classList.add(allHealthy ? 'ok' : 'down');
  statusText.textContent = allHealthy
    ? 'All monitored APIs are responding normally.'
    : 'Some monitored APIs are degraded or unavailable.';
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function rowMarkup(check) {
  const stateClass = check.ok ? 'state-ok' : 'state-down';
  const stateLabel = check.ok ? 'UP' : 'DOWN';
  const code = check.status ?? '--';
  const checked = formatTime(check.checkedAt);
  const latency = `${check.latencyMs} ms`;
  const safeName = escapeHtml(check.name);
  const safeUrl = escapeHtml(check.url);

  return `
    <tr>
      <td>${safeName}</td>
      <td><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a></td>
      <td><span class="state-pill ${stateClass}">${stateLabel}</span></td>
      <td>${code}</td>
      <td>${latency}</td>
      <td>${checked}</td>
    </tr>
  `;
}

function getCombinedChecks() {
  return [...majorChecks, ...customChecksByUrl.values()];
}

function renderDashboard(lastCheckedAt) {
  const checks = getCombinedChecks();
  const upCount = checks.filter((item) => item.ok).length;
  const downCount = checks.length - upCount;
  const averageLatencyMs = checks.length
    ? +(checks.reduce((sum, item) => sum + Number(item.latencyMs || 0), 0) / checks.length).toFixed(2)
    : 0;

  upValue.textContent = upCount;
  downValue.textContent = downCount;
  avgLatencyValue.textContent = `${averageLatencyMs} ms`;
  totalValue.textContent = checks.length;

  const allHealthy = downCount === 0;
  setPlatformStatus(allHealthy);

  if (!checks.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="placeholder-row">No monitored targets found.</td></tr>';
  } else {
    tbody.innerHTML = checks.map((check) => rowMarkup(check)).join('');
  }

  metaLine.textContent = `Last scan at ${formatTime(lastCheckedAt)} | ${upCount}/${checks.length} healthy`;
}

async function runScan() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Scanning...';

  try {
    const response = await fetch('/api/scan', { cache: 'no-store' });
    if (!response.ok) throw new Error('Scan endpoint returned a non-200 response');

    const payload = await response.json();
    majorChecks = payload.checks;
    renderDashboard(payload.checkedAt);
  } catch (error) {
    setPlatformStatus(false);
    metaLine.textContent = `Scan failed: ${error.message}`;
    if (!getCombinedChecks().length) {
      tbody.innerHTML = '<tr><td colspan="6" class="placeholder-row">Unable to load scan data.</td></tr>';
    }
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Scan Now';
  }
}

async function runCustomCheck(url, label) {
  customResult.textContent = 'Checking custom URL...';

  try {
    const response = await fetch(
      `/api/check?url=${encodeURIComponent(url)}&label=${encodeURIComponent(label || '')}`,
      { cache: 'no-store' }
    );
    const payload = await response.json();

    if (response.status === 400) {
      customResult.textContent = `Invalid link: ${payload.message || 'Please enter a valid http/https URL.'}`;
      customResult.classList.add('bad');
      return;
    }

    if (!payload.url || !payload.checkedAt) {
      throw new Error(payload.message || payload.error || 'Custom check failed');
    }

    customChecksByUrl.set(payload.url, {
      ...payload,
      name: payload.name || 'Custom Target'
    });
    renderDashboard(payload.checkedAt);

    customResult.textContent = `${payload.name} | ${payload.ok ? 'UP' : 'DOWN'} | Code: ${payload.status ?? '--'} | Latency: ${payload.latencyMs} ms`;
    customResult.classList.toggle('bad', !payload.ok);
  } catch (error) {
    customResult.textContent = `Error: ${error.message}`;
    customResult.classList.add('bad');
  }
}

refreshBtn.addEventListener('click', runScan);
customForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const url = customUrlInput.value.trim();
  const label = customLabelInput.value.trim();
  if (!url) return;
  customResult.classList.remove('bad');
  runCustomCheck(url, label);
});

kineticTitle();
runScan();
setInterval(runScan, 12000);
